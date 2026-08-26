# 系统架构

> 本文描述运行时拓扑、包依赖与隔离机制。理念背景见 [01-design-philosophy.md](./01-design-philosophy.md)，代码模板见 [04-patterns-and-recipes.md](./04-patterns-and-recipes.md)。

---

## 1. 三层运行时

```
┌───────────────────────────────────────────────────────────────────┐
│  Layer 0: Cordis（DI / lifecycle 基础设施）                       │  ← 库，不可见
│    · Context 原型链继承、Service provide/inject                   │
│    · Fiber lifecycle、事件系统、isolate 机制                      │
├───────────────────────────────────────────────────────────────────┤
│  Layer 1: @athena-ai/core（框架内核，prelude）                    │  ← 不可卸载
│    · 当前：cordis / cosmokit / schemastery 的重导出 + 空 apply()  │
│    · 未来：pre-processing hooks、全局 middleware、共享工具        │
├───────────────────────────────────────────────────────────────────┤
│  Layer 2: app.yml managed plugin tree                             │  ← 用户可配置
│    · @athena-ai/plugin-life（provides 'life'）                    │
│    · @athena-ai/cortex-chat（provides 'cortex'）                  │
│    · @athena-ai/nerve-*（Body 实现，注册进 ctx.nerve）            │
│    · @cordisjs/plugin-webui / -hmr / -database-sqlite 等生态插件  │
└───────────────────────────────────────────────────────────────────┘
```

### 1.1 Prelude vs Managed Plugin

Cordis loader 区分两类插件安装：

| 类别        | 何时加载                       | 由谁管理                    | 用户能卸载吗           | 例                                                       |
| ----------- | ------------------------------ | --------------------------- | ---------------------- | -------------------------------------------------------- |
| **Prelude** | loader 解析 `app.yml` **之前** | 硬编码在 `cordis.yml` / CLI | ❌ WebUI 中不可见      | `plugin-env`、`plugin-logger-console`、`@athena-ai/core` |
| **Managed** | loader 启动后，来自 `app.yml`  | Loader + WebUI              | ✅ 可通过 UI 禁用/移除 | `nerve-onebot`、`cortex-chat`                            |

**`@athena-ai/core` 是 prelude 级安装。** 它在 managed plugin tree 之前加载，在插件管理 UI 中不可见，无法被"卸载"。

这与 Koishi 对 cordis 的关系在结构上**完全一致**：

```
Koishi 生态：                        Athena 生态：
────────────                        ────────────
cordis（库）                         cordis（库）
@koishijs/core（prelude，内核）       @athena-ai/core（prelude，内核）
koishi start（品牌 CLI）              cordis run（复用 cordis CLI；自有 CLI 延后）
app.yml plugins（可卸载）             app.yml plugins（可卸载）
```

**身份差异**：Koishi core 继承 `satori.Context` → 框架身份 = messaging。Athena core **不**继承任何 IM 上下文 → 框架身份 = digital life。Messaging 是 Layer 2 的 managed plugin（Nerve adapter），不是内核的一部分。

### 1.2 独立性判据

判据不是"有没有品牌 CLI"，而是"有没有定义框架身份的 prelude 级内核"：

| 判据      | YesImBot（❌ 不独立）          | Athena（✅ 独立）                            |
| --------- | ------------------------------ | -------------------------------------------- |
| Core 位置 | app.yml（managed，用户可卸载） | prelude（内核，不可卸载）                    |
| 框架身份  | Koishi 中众多插件之一          | **所有**其他插件依赖的 prelude               |
| 没有它时  | Koishi 照常工作                | 进程失去意义（所有插件注入 core 服务）       |
| 生态关系  | Koishi 生态的消费者            | Koishi 的同侪（都是 cordis 系框架）          |
| 入口      | `koishi start`                 | `cordis run`（当前）/ `athena start`（未来） |

**测试**：从 prelude 移除 `@athena-ai/core` → 所有 capability/cortex 插件因未满足 inject 依赖而无法激活 → 进程成为空壳。Core **就是**框架。

> ⚠️ **当前状态注意**：`@athena-ai/core` 目前只是 re-export shell（`export * from "cordis"` 等）+ 空 `apply()`。上述"移除即空壳"的性质来自其他包对它的 import 依赖（类型与 `Schema`），而非运行时 service 注入。这是有意的最小化起点，Phase 2 会补充实质内容。

### 1.3 CLI 入口

当前阶段直接用 cordis CLI，不自建 `@athena-ai/cli`：

```yaml
# cordis.yml — 标准 cordis bootstrap
- name: "@cordisjs/plugin-cli"
  config:
    name: athena
- name: "@cordisjs/plugin-cli-cordis"
  config:
    path: ./app.yml
    daemon:
      enabled: true
    prelude:
      - name: "@cordisjs/plugin-env"
      - name: "@cordisjs/plugin-logger-console"
      - name: "@athena-ai/core" # 空 shell，无 config
```

为什么足够：core 在 prelude → 不可卸载、WebUI 插件管理中不可见；所有 cordis 生态插件（HMR、webui、database、market）在 app.yml 中照常工作；daemon 模式（自动重启、心跳）由 `plugin-cli-cordis` 提供。未来的品牌 CLI 只需换入口二进制，prelude 机制不变，架构零改动。

---

## 2. Package 架构与依赖图

### 2.1 当前包清单

| 包                                | 路径                        | 提供的 Service | 角色                                                                                                                        |
| --------------------------------- | --------------------------- | -------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `@athena-ai/core`                 | `packages/core`             | —              | Prelude shell；重导出 cordis/cosmokit/Schema                                                                                |
| `@athena-ai/protocol`             | `packages/protocol`         | `nerve`        | Nerve 核心：Body 基类、Session 信封、NerveService、Cortex 基类、Hook Protocol 契约                                        |
| `@athena-ai/protocol-im`          | `packages/protocol-im`      | —              | IM 协议层：实体类型、Methods 表、IMBody 默认实现、事件契约、MessageEncoder、WsClient                                        |
| `@athena-ai/ai`                   | `packages/ai`               | `ai`           | AIService：Provider Registry、`models.yml` 加载、各模态模型解析、Candidate/Group                                            |
| `@athena-ai/plugin-life`          | `plugins/life`              | `life`         | Life 实现：persona、memory、one-Cortex 强制                                                                                 |
| `@athena-ai/cortex-chat`          | `plugins/cortex-chat`       | `cortex`       | Reactive Cortex（当前为 echo 骨架，消费 `message-created` 事件）                                                            |
| `@athena-ai/plugin-sandbox`       | `plugins/sandbox`           | `sandbox`      | 全局 SandboxHub + SandboxBot（IMBody 实现）：WebUI 页面、文件服务器、WS 路由                                                |
| `@athena-ai/sandbox-nerve`        | `plugins/sandbox-nerve`     | —              | per-Life Nerve：注册 Hub、创建 SandboxBot（`ctx.nerve` 注册）                                                               |
| `@athena-ai/provider-openai`      | `plugins/provider-openai`   | —              | 注册 AI SDK OpenAI provider（`reusable`，可多实例）                                                                         |
| `@athena-ai/provider-deepseek`    | `plugins/provider-deepseek` | —              | 注册 AI SDK DeepSeek provider（`reusable`，可多实例）                                                                       |
| `@athena-ai/nerve-onebot`         | `plugins/nerve-onebot`      | —              | OneBot v11 Nerve adapter（IMBody 实现）：message receive/send path，依赖 `protocol`、`protocol-im` 与 HTTP WebSocket        |
| `@athena-ai/plugin-content-filter` | `plugins/content-filter`   | —              | Hook Protocol 参考插件：监听 `cortex/before-enact`，按配置内容结构化否决行动                                                  |
| `@athena-ai/plugin-message-store` | `plugins/message-store`     | —              | 占位，未开始（Phase 3 消息持久化）                                                                                          |

### 2.2 依赖方向

```
                    cordis（所有包的 peerDependency）
                            │
                    @athena-ai/core
                    （re-export shell）
                            │
                    @athena-ai/protocol
              （Body 基类 + NerveService + module augmentation）
                            ↑
                    @athena-ai/protocol-im
              （IMBody + 实体类型 + cordis.Events 声明）
              ↑                    ↑
        ┌─────┘                    └──────┐
        │                                 │
@athena-ai/nerve-onebot        @athena-ai/cortex-chat
（IMBody 实现，inject:        （inject: ['life', 'nerve']）
 ['nerve', 'http']）

@athena-ai/plugin-life（provides 'life'）        @athena-ai/plugin-sandbox（provides 'sandbox'，root 级）
        ↑                                                ↑
@athena-ai/cortex-chat（inject: ['life', 'nerve']）  @athena-ai/sandbox-nerve（inject: ['sandbox', 'nerve', 'life']，per-Life）

@athena-ai/ai（provides 'ai'，root 级全局单例）
        ↑
@athena-ai/provider-*（inject: ['ai']；createXxx() → ctx.ai.register(id, provider)）
```

### 2.3 铁律

1. **Cortex 依赖 `protocol` 的事件契约，永不依赖 `nerve-*` / adapter。** 事件通过 `cordis.Events` 声明消费（如 `message-created`），发送通过事件上的 `body` 引用。
2. **`protocol` 不依赖 `protocol-im`。** IM 是可选增强：`protocol-im` 声明合并进 `Body` / `Event` / `cordis.Events`，并用 `defineAccessor` 把 IM 访问器挂到 `Session.prototype` 上。
3. **`protocol-im` 不依赖 `core`。** 它只依赖 `protocol` + `@cordisjs/element`。
4. **`cordis` 永远在 `peerDependencies`**，多副本会导致 Symbol 身份不同、隔离静默失效。

### 2.4 包命名规则

npm scope：`@athena-ai`（工作名，未来可能替换为最终品牌名）

| 包类型          | 官方模式                       | 社区（无 scope）           | 社区（有 scope）                  |
| --------------- | ------------------------------ | -------------------------- | --------------------------------- |
| Core / 基础设施 | `@athena-ai/core`              | —                          | —                                 |
| Capability 契约 | `@athena-ai/capability-<name>` | `athena-capability-<name>` | `@scope/athena-capability-<name>` |
| Cortex 插件     | `@athena-ai/cortex-<name>`     | `athena-cortex-<name>`     | `@scope/athena-cortex-<name>`     |
| Nerve 插件      | `@athena-ai/nerve-<name>`      | `athena-nerve-<name>`      | `@scope/athena-nerve-<name>`      |
| 通用插件        | `@athena-ai/plugin-<name>`     | `athena-plugin-<name>`     | `@scope/athena-plugin-<name>`     |
| Provider 插件   | `@athena-ai/provider-<name>`   | `athena-provider-<name>`   | `@scope/athena-provider-<name>`   |

理由：Cortex 和 Nerve 是本身携带类型信息的领域概念，不需要冗余的 `plugin-` 前缀。Provider 插件同理 —— 它只向 `ctx.ai` 注册一个 AI SDK provider，是独立的一类角色。不属于上述分类的通用插件（memory、scheduler）用 `plugin-` 前缀，与 Cordis/Koishi 生态约定一致。纯库包（core、protocol、ai）无前缀。

---

## 3. 单 Life 运行时拓扑

```
┌─ Cordis Root Context ─────────────────────────────────────────────────────——┐
│                                                                             │
│  prelude: @athena-ai/core, plugin-env, plugin-logger-console                │
│  全局基础设施: plugin-webui, plugin-hmr, plugin-server, plugin-database     │
│  全局 Hub: @athena-ai/plugin-sandbox（provides 'sandbox'）                  │
│                                                                             │
│  ┌─ Life Group Context（@cordisjs/plugin-group）──────────────────────——┐   │
│  │  isolate: { life, cortex, nerve }                                 │   │
│  │                                                                   │   │
│  │  ctx.life = Life                       ← persona / memory         │   │
│  │                                                                   │   │
│  │  ctx.nerve = NerveService              ← Body 注册表              │   │
│  │    └── bodies: [OneBotBody, SandboxBot, ...]  ← 按 sid 寻址        │   │
│  │                                                                   │   │
│  │  ctx.cortex = CortexChat               ← inject: ['life','nerve'] │   │
│  │    ├── ctx.on('message-created', ...)                             │   │
│  │    ├── event.body.sendMessage(...)                                │   │
│  │    └── ctx.life.persona                                           │   │
│  │                                                                   │   │
│  │  Nerve adapter（nerve-onebot / sandbox ...）  ← inject: ['nerve'] │   │
│  │    └── 继承 IMBody，基类 Service.init 自动注册进 ctx.nerve        │   │
│  │                                                                   │   │
│  │  @athena-ai/sandbox-nerve              ← inject:['sandbox','nerve',│   │
│  │    └── 向 root 的 Hub 注册，本地创建 SandboxBot        'life']    │   │
│  └────────────────────────────────────────────────────────────────────——┘   │
└──────────────────────────────────────────────────────────────────────────——─┘
```

### 3.1 与早期 spec 的差异

`capability-message-design.md` 曾设计 MessageService 在构造函数内部自行 `ctx.isolate('satori').isolate('bots')` 创建**内部**隔离域，使 `ctx.satori` 对整个 Life context 都不可见。

**实际实现改为**：隔离由**外层 group entry 声明**（`isolate: { satori: true }`），MessageService 在自己的 context 上直接 `ctx.plugin(Satori)`。

改动原因：adapter 是 group 内的 sibling entry，它们需要 `inject: ['satori']` 才能注册 Bot。如果 satori 被 MessageService 私有化，sibling adapter 就拿不到它。折中结果是 **satori 在 group 内可见，跨 group 隔离**。

对应决策修订：`M-01` → 由 `multi-life-isolation-design.md` §5 修订为"satori 在 group 内可见（adapter 需要），对 group 外隐藏"。

---

## 4. Multi-Life 隔离

### 4.1 载体形态

- **容器**：`@cordisjs/plugin-group`，配置 `isolate: { life: true, cortex: true, nerve: true }`
- **Service**：`@athena-ai/plugin-life` 提供 `'life'`，每 group 一个 fiber
- **生命周期**：
  - 启动：group → Life 激活 → Cortex inject life → `bind()` → Cortex 激活
  - 销毁：group disposed → Cortex fiber dispose → yielded disposer 触发 → `_cortex = null` → Life fiber dispose
- **资源回收**：cordis fiber dispose 自动执行所有收集到的 disposable

### 4.2 为什么这三个 key 都要隔离

| Key      | 不隔离的后果                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------ |
| `life`   | 两个 group 共享同一个 Life 实例 → 第二个 Cortex `bind()` 抛 `Only one Cortex per Life`                             |
| `cortex` | 第二个 CortexChat 的 `provide('cortex', self)` 撞上已存在的 store slot → 抛 `service "cortex" has been registered` |
| `nerve`  | 事件作用域失效：`body.dispatch` 的事件会广播给所有 Life 的 Cortex                                                  |

### 4.3 目标 app.yml

```yaml
# 全局 Hub（root 级，不在任何 group 内）
- name: "@athena-ai/plugin-sandbox"

# === Alice ===
- name: "@cordisjs/plugin-group"
  label: Alice
  isolate:
    life: true
    cortex: true
    nerve: true
  config:
    - name: "@athena-ai/plugin-life"
      config:
        persona:
          name: Alice
          description: A curious and friendly digital life.
          traits: { personality: curious, friendly, helpful }
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/sandbox-nerve"
    - name: "@athena-ai/nerve-onebot"
      config: { selfId: "123", endpoint: ws://..., protocol: ws }

# === Bob ===
- name: "@cordisjs/plugin-group"
  label: Bob
  isolate:
    life: true
    cortex: true
    nerve: true
  config:
    - name: "@athena-ai/plugin-life"
      config:
        persona:
          name: Bob
          description: A thoughtful digital philosopher.
          traits: { personality: contemplative }
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/sandbox-nerve"
    - name: "@athena-ai/nerve-onebot"
      config: { selfId: "456", endpoint: ws://..., protocol: ws }

# 共享基础设施（在所有 Life scope 之外）
- name: "@cordisjs/plugin-database-sqlite"
- name: "@cordisjs/plugin-hmr"
- name: "@cordisjs/plugin-webui"
```

注意：`sandbox` **不**在 group 的 isolate 列表中。Hub 是全局的，Nerve 通过从 root 正常 inject 抵达它（M-30）。`nerve` 在 isolate 列表中，保证每个 Life 的事件空间独立。

### 4.4 Isolate 的精确语义

理解这一点对写 capability 至关重要：

| 机制                   | 注册位置                    | 键类型     | 是否受 isolate 影响 |
| ---------------------- | --------------------------- | ---------- | ------------------- |
| `provide(name, value)` | `store[ctx[isolate][name]]` | **Symbol** | ✅ 是               |
| `accessor(name, opts)` | `props[name]`               | **String** | ❌ 否（全局唯一）   |
| `mixin(source, keys)`  | 对每个 key 调 `accessor`    | **String** | ❌ 否（全局唯一）   |

**`ctx.isolate(name)` 只影响 service 查找（store），不影响属性描述符注册（props）。**

```typescript
// cordis/packages/core/src/context.ts
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate]);
  shadow[name] = label ?? Symbol(name);
  return this.extend({ [symbols.isolate]: shadow });
}
```

`ctx.isolate(name)` **不创建子 context**。它创建一个扩展 context 对象，其 `[symbols.isolate]` 通过原型链被 shadow，`isolate[name]` 指向一个新 Symbol。任何在该 Symbol 下 provide 的 service，对使用原 Symbol 的 context 不可见。

**关键约束**：任何在构造函数中调用 `ctx.mixin()` 的 Service，在整个 cordis 进程中**只能有一个存活的 fiber**。accessor 的 effect-dispose（`delete this.props[name]`）只在 fiber 被销毁时运行；两个 fiber 共存期间，第二次注册必然抛错。

这是我们移除 vendored Satori 的 `ctx.mixin('satori', ['bots', 'component'])` 的直接原因。详见 [05-lessons-learned.md](./05-lessons-learned.md) §1。

---

## 5. 事件流全路径

```
平台（QQ / Discord / ...）
  │  WebSocket / HTTP
  ▼
Nerve adapter（@athena-ai/nerve-onebot 等，IMBody 实现）
  │  1. 平台事件 → adaptSession() → body.session({ ...嵌套数据 })
  │  2. body.dispatch(session)
  ▼
Body.dispatch(session)
  │  packages/protocol/src/nerve.ts
  │  this.ctx.emit("internal/session", session)
  ▼
NerveService 归一化器（root）
  │  internal → emit(_type, _data)；其余 → body.ctx.emit(session.type, session)
  ▼
Cordis EventsService
  │  按 isolate 作用域投递给 hook
  ▼
Cortex 的 ctx.on('message-created', handler)
  │  event.body = 来源 Body（IMBody 实例）
  ▼
Cortex 内部缓冲策略（willingness / mailbox / debounce）
  ▼
Cognition（AI SDK generateText / streamText）
  ▼
Enactment: event.body.sendMessage(event.channelId, content)
  │
  ▼
IMBody 默认实现 → createMessage → adapter 平台编码
  │
  ▼
Nerve adapter → 平台
```

### 5.1 事件过滤机制细节

Cordis 的事件分发核心：

```typescript
// EventsService._resolve()
private _resolve(type, args) {
  const thisArg = /* 第一个参数若为 object */;
  const filter = thisArg?.[Context.filter];
  return [thisArg, hooks
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
    .map(hook => hook.callback)];
}
```

- 每个 listener（`hook`）记住它注册所在的 `ctx`（`hook.ctx`）
- 事件带 `thisArg` 发射时，cordis 检查 `thisArg[Context.filter]`
- 若 filter 存在，对每个 `hook.ctx` 调用它 —— 只有返回 `true` 的 hook 收到事件
- 若 filter 缺失，**所有** hook 都收到（广播）

Satori Session 默认**不**定义 `[Context.filter]`：

```typescript
public[Service.tracker] = { associate: "session", property: "ctx" };
// 无 [Context.filter] → 广播
```

所以必须由 MessageService 注入。

### 5.2 Traced Proxy 陷阱

`Session` 和 `Bot` 都声明了 `[Service.tracker] = { property: "ctx" }`，这让 `session.bot.ctx` 解析为**接收方**的 context，而不是拥有该 bot 的 context。直接比较会导致每个 MessageService 实例都认领每个 session（最后写入者胜出）。

解法是先 unwrap 到原始对象：

```typescript
const ORIGINAL = Symbol.for("cordis.original");

function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}
```

### 5.3 按部署模式的行为

| 模式        | `message` symbol                                                 | 效果                                       |
| ----------- | ---------------------------------------------------------------- | ------------------------------------------ |
| **单 Life** | 一个全局 symbol（`message` 未被 isolate）                        | 所有 listener 匹配 → 广播（等同无 filter） |
| **多 Life** | 每个 group 有 `isolate: { message: true }` → 每 Life 私有 symbol | 事件仅限拥有它的 Life 的 listener          |

---

## 6. Capability 模式

### 6.1 三个角色

```
Cortex   ──depends on──►  Capability（interface / contract）
Nerve    ──implements──►  Capability（提供具体实现）
```

**Capability 包的职责**：

1. **Service 接口/基类** —— 定义该 capability 的 API 形状
2. **多实例容器** —— Nerve 实例的注册/发现/寻址
3. **事件类型定义** —— 该 capability 发射哪些 Cordis 事件
4. **共享类型** —— Nerve 和 Cortex 都用到的数据结构

**Capability token**（稳定标识符，对应 Cordis Service provide key）：

- `'message'` —— messaging / IM 交互 ✅ 已实现
- `'minecraft'` —— 3D 世界交互（未来）
- `'expression'` —— 视觉表达 / Live2D（未来）
- `'audio'` —— 语音/声音交互（未来）

枚举是**开放**的（可加新 key），但每个 key 一旦确立就**稳定**。

> `'ai'`（`AIService`）、`'sandbox'`（SandboxHub）、`'life'`、`'cortex'` 也是 provide key，但**不是** capability token —— capability 描述"与世界交互的一个维度"，这几个是基础设施。区别在于：capability 有 Nerve 实现它，基础设施没有。

### 6.2 Cortex 契约

- Cortex **是**一个 Cordis Service，通过 `ctx.plugin(CortexChat, config)` 安装
- 用 `static inject = [...]` 声明必需 capability
- 可选 capability **不能**用 `inject` 表达 —— cordis v4 的 `inject` 全部是必需项（无 `static optional`）。可选依赖用 `ctx.get("name")`（不可用时返回 `undefined`）或嵌套 `ctx.inject([...], cb)` 子 fiber
- Cordis 校验 inject 依赖 —— 缺少必需 capability 时 Cortex 不启动（fiber 停留在 PENDING）
- Life 级 isolate context 保证每个 Life 至多一个 Cortex
- 生命周期遵循 Cordis fiber 语义 —— 不需要自定义 lifecycle 方法

### 6.3 Nerve 契约

- Nerve 是继承 `Body`（或 `IMBody`）注册进 `ctx.nerve` 的 Cordis 插件
- IM Nerve 继承 `IMBody`，基类 `Service.init` 自动注册进 `ctx.nerve`（按 `platform:selfId` 寻址）
- 非 IM Nerve 继承 `Body`，向对应能力注册连接
- Nerve 通过 `body.dispatch(event)` 发射领域事件到 Cordis 事件系统
- Nerve 内部处理平台特定的连接、认证、重连
- 同类型多个 Nerve → `ctx.nerve` 中的多个 Body 实例

**"Service 存在但无 Nerve 注册"**：`ctx.on(...)` 收不到事件；`ctx.nerve.get(sid)` 返回 undefined。

### 6.4 多 Nerve 寻址

Cortex 用 `body.sid`（`platform:selfId`）寻址具体 Body：

- 事件携带来源身份（`event.body.sid`）
- Cortex 的 enactment 阶段直接调用 `event.body.sendMessage(...)`——事件自带来源，无需额外寻址
- 需要主动查询时 `ctx.nerve.get(sid)` / `ctx.nerve.bodies` 可用
- 单 Body Cortex：事件自带的 body 就够（只有一个目标）
- 多 Body Cortex：事件天然区分来源，无需显式指定

---

## 7. IM 事件契约与发送 API

```typescript
// === Body Registry（protocol 的 NerveService）===
ctx.nerve.get(sid): Body | undefined;   // sid = "platform:selfId"
ctx.nerve.bodies: Body[];

// === 事件消费（protocol-im 声明在 cordis.Events）===
ctx.on("message-created", (event: IMMessageEvent) => {
  /* 新消息：event.channelId / event.userId / event.message / event.body */
});
ctx.on("message-updated", (event) => { /* 编辑 */ });
ctx.on("message-deleted", (event) => { /* 删除 */ });
ctx.on("reaction-added", (event) => { /* 表态 */ });
ctx.on("guild-member-added", (event) => { /* 入群 */ });
// ... 完整 IM 事件集（见 protocol-im/src/events.ts）

// === 发送（通过事件上的 body 引用）===
await event.body.sendMessage(event.channelId, content);
await event.body.sendPrivateMessage(userId, content);
```

### 7.1 设计理由

**为什么事件携带 `body` 引用？**

- Cortex 拿到事件即可直接回复，无需先寻址——`event.body` 就是来源 Body
- 多 Body 场景下事件天然携带来源，不需要额外的 botSid 参数
- Body 实现完整的 `IMBody` 方法集（`sendMessage` / `getGuild` / `getGuildMemberList` …）——Cortex 可直接调用
- 未实现的方法显式抛 `not implemented`，不会静默失败

**为什么通过 `ctx.nerve` 寻址？**

- 单 Body 部署时通常用不上——事件自带的 `body` 就够
- 需要主动查询（如列出所有连接、按平台过滤）时 `ctx.nerve.get(sid)` / `ctx.nerve.bodies` 可用

**为什么事件类型是具体接口（`IMMessageEvent` 等）？**

- 运行时统一用 **Session 信封**传播（satori 模式），类型层用具体接口收窄——`IMMessageEvent` 等 `extends Session`，把 `type` 收窄为字面量、把访问器字段收窄为必填
- `Session`（core）是基础信封（`event` 数据 + `sn`/`body` + 基础访问器）；protocol-im 用 `defineAccessor` 把 IM 访问器（`content`/`channelId`/`userId`/`guildId`/`isDirect`/`quote`…）挂到 `Session.prototype`，由 `session.event` 嵌套对象推导
- 消费方类型精确（`event.channelId: string`），运行时拿到的是带访问器的 Session 实例

### 7.2 事件契约

**事件管线：`dispatch(session)` → `internal/session` → 归一化 → 正式事件**

```text
adapter
  │  body.session({ type, channel, user, message, ... })   ← 填嵌套数据对象
  ▼
Body.dispatch(session)
  │  ① this.ctx.emit("internal/session", session)          ← 统一入口（拦截/转发/持久化挂载点）
  ▼
NerveService 归一化器（root 注册）
  │  ① internal 类型 → emit(event._type, event._data)      ← satori 模式：onebot/poke 等子事件
  │  ② 其余 → session.body.ctx.emit(session.type, session) ← 从来源域重发射，保持 Life 隔离
  ▼
cordis.Events 消费者（ctx.on("message-created", ...)）
```

- adapter 只需填**嵌套数据对象**（`channel`/`user`/`guild`/`message`），`channelId`/`userId`/`guildId`/`isDirect`/`content` 由 Session 的 IM 访问器推导——不再手工填派生字段
- 事件是 **Session 实例**（带访问器），类型上按 `IMMessageEvent` 等接口收窄
- **无事件别名**（`eventAliases` 已删除）；`internal` 子事件按 `_type` 发射（`onebot/poke` 等）

```typescript
ctx.on("message-created", (event: IMMessageEvent) => {
  // event.body: 来源 Body（IMBody 实例）
  // event.channelId / event.userId / event.content（访问器推导）
  // event.isDirect（channel.type === DIRECT 推导）
  // event.message（访问器）
});
```

```

---

## 8. Sandbox 架构（Hub + Nerve 分离）

### 8.1 问题

Sandbox 插件注册唯一的 WebUI 页面（`/sandbox`）和全局 WebSocket 监听器。多个 Life group 各自安装它时，路由冲突、bot domain 冲突。

### 8.2 方案

```

Root Context
├── SandboxHub（inject: ['webui']，provides: 'sandbox'）
│ ├── 注册 /sandbox 页面（一次）
│ ├── 文件服务器挂在 /sandbox/file
│ ├── WebSocket 监听：sandbox/send-message, sandbox/response,
│ │ sandbox/delete-message, sandbox/lives
│ ├── Life registry: Map<lifeId, SandboxNerveHandle>
│ └── 按 lifeId 路由 → nerve.dispatch(payload with sink)
│
├── Alice Group（isolate: { life, cortex, nerve }）
│ └── SandboxNerve（inject: ['sandbox', 'nerve', 'life']）
│ ├── 以 lifeId='alice' 向 Hub 注册
│ └── 在本地 ctx.nerve 中创建 SandboxBot
│
└── Bob Group（isolate: { life, cortex, nerve }）
└── SandboxNerve（inject: ['sandbox', 'nerve', 'life']）
├── 以 lifeId='bob' 向 Hub 注册
└── 在本地 ctx.nerve 中创建 SandboxBot

````

### 8.3 契约（定义在 `@athena-ai/protocol`）

```typescript
/** 传输抽象 —— Nerve/Bot 不依赖 WebUI 内部实现 */
interface MessageSink {
  send(frame: { type: string; body: unknown }): void;
}

/** Hub → Nerve 的派发载荷 */
interface SandboxDispatchPayload {
  clientId: string; // WebUI 客户端 id（浏览器标签）
  platform: string; // sandbox 平台标识（每标签唯一）
  user: string;
  channel: string;
  content: string;
  quote?: { id: string; content: string; user: string };
  sink: MessageSink; // 回复回原标签的传输通道
}

/** Nerve 向 Hub 暴露的句柄 */
interface SandboxNerveHandle {
  meta: { name: string; description?: string };
  dispatch(payload: SandboxDispatchPayload): Promise<void>;
  request(method: string, data: Record<string, unknown>): Promise<unknown>;
  release(payload: { clientId: string; platform: string }): Promise<void>;
}

/** 全局 Hub service */
interface SandboxHubService {
  register(lifeId: string, nerve: SandboxNerveHandle): () => void;
  lives(): { id: string; meta: SandboxNerveHandle["meta"] }[];
  readonly fileBase: string | undefined;
}
````

关键设计：

- 所有 `sandbox/*` wire frame 携带 `lifeId` 字段，单个 WebSocket 多路复用多个 Life，前端按 lifeId 路由（M-28）
- Hub 在 dispatch payload 中传入 `MessageSink` 作为回复传输通道；Nerve/Bot 不依赖 WebUI 内部；Hub 自动在回复上打 lifeId（M-29）
- `sandbox` **不**被 group isolate（M-30）

### 8.4 Sandbox 是 Nerve 模式的参考实现

Sandbox 展示了非 IM 平台如何接入：它不是 Satori adapter，而是自己创建 `SandboxBot`（继承 Satori `Bot`）注册进本地 `ctx.satori`。这条路径对未来的 `capability-minecraft` / `capability-audio` 同样适用 —— 只是注册目标换成对应的 capability service。

---

## 9. AI 基础设施集成点

### 9.1 AIService（`packages/ai`，provides `ai`）

`AIService` 是 **root 级全局单例**，不进 `{ life, cortex, message, satori }` 隔离集合 —— 模型是无状态共享资源，且 AI SDK 的 `ProviderV4` 天然跨模态（D-33）。

职责三分：

| 层                | 内容                                                                                                      |
| ----------------- | --------------------------------------------------------------------------------------------------------- |
| Provider Registry | `Map<id, ProviderV4>`，由 `provider-*` 插件在 `apply()` 中注册，fiber dispose 时注销                      |
| 模型知识          | `models.yml`：模型声明与元数据、aliases、per-modality defaults、groups、per-provider/per-model 调用默认值 |
| 解析              | 拼装两者，返回**已注入默认参数的 AI SDK 原生模型**                                                        |

```typescript
class AIService extends Service<AIServiceConfig> {
  register(id: string, provider: ProviderV4): () => void; // id 重复 → logger.error + throw
  providers(): string[];

  language(input?: string): LanguageModelV4; // input 省略 → defaults.language
  embedding(input?: string): EmbeddingModelV4;
  image(input?: string): ImageModelV4;
  speech(input?: string): SpeechModelV4;
  transcription(input?: string): TranscriptionModelV4;
  reranking(input?: string): RerankingModelV4;

  candidates(input: string): Candidate[]; // 统一入口：单模型 / group / alias
  group(name: string): ModelGroup; // 显式取 group，不存在则抛

  default(type: ModelType): string | undefined;
  metadata(fullId: string): ModelMetadata | undefined;
  list(type?: ModelType): ModelEntry[];
}
```

**Provider 插件只带凭据**（D-34）—— 前端表单只有 `id` / `apiKey` / `baseURL` 三个字段：

```typescript
export const inject = ["ai"];
export const reusable = true; // 同一包可多实例（官方 key + 内部网关）

export function apply(ctx: Context, config: Config) {
  const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-openai(${config.id}).unregister`);
}
```

模型 ID 格式：`${providerId}:${modelId}`，**按第一个 `:` 切分**（所以 `ollama:llama3:8b` 正确解析）。类型上就是 `string`，不做模板字面量类型。

#### 解析时的 middleware 注入

Provider 插件注册的是**裸 provider**。`models.yml` 中的默认值由 AIService 在解析时用 **AI SDK 自己的** `defaultSettingsMiddleware` + `wrapLanguageModel` 注入 —— 使用 AI SDK 的 middleware 不算"加抽象层"。

优先级（高 → 低）：

```
1. 运行时调用参数（Cortex 传给 streamText / generateText 的）
2. models.yml → providers.<id>.models[].defaults      （per-model）
3. models.yml → providers.<id>.defaults               （per-provider）
4. models.yml → providers.<id>.options.headers        （per-provider transport）
```

`defaultSettingsMiddleware` 内部就是 `mergeObjects(settings, params)`——深合并、调用方参数胜出，所以上表的顺序是 AI SDK 原生语义，不是我们叠的规则。非 language 模态：embedding / image 走 `wrap*Model` 注入 `headers` / `providerOptions`；speech / transcription / reranking 上游没有对应 wrapper，返回裸模型。

解析结果按 `type + fullId` 缓存；provider 注册/注销时整表失效。

### 9.2 LLM 调用链

简单场景（单模型）：

```typescript
const model = ctx.ai.language(); // 或 ctx.ai.language("openai:gpt-4o") / ctx.ai.language("fast")
const result = streamText({ model, messages, tools, stopWhen: [stepCountIs(10)] });
```

生产场景（failover）—— **循环在 Cortex 里，框架只给候选列表**（D-35）：

```typescript
for (const candidate of ctx.ai.candidates(this.config.model)) {
  try {
    const response = streamText({ model: candidate.model, messages, tools, maxRetries: 0 });
    for await (const part of response.fullStream) {
      /* 消费 */
    }
    candidate.success();
    return response;
  } catch (e) {
    candidate.failure(); // 喂断路器
    this.ctx.logger("cortex-chat").warn(`Model ${candidate.id} failed:`, e);
  }
}
throw new Error("All models exhausted");
```

`candidates(input)` 的三条路径：含 `:` → 单模型；否则先查 groups，再查 aliases。Group 候选带该 group 的断路器；单模型候选的 `success()` / `failure()` 是 no-op（无 group 即无断路器）。

Group 只做**排序 + 跳过断路器已开的模型**，策略为 `failover` / `round-robin` / `random`。两条刻意的降级行为：

- **成员解析失败**（provider 未注册）→ 跳过该成员并 warn，不让整个 group 失败
- **全部断路器都开** → warn 后仍返回完整列表。哑掉的数字生命比多一次注定失败的尝试更糟

**不做 LLM 抽象层。** AI SDK v7 已提供多 provider 支持、tool calling、structured output、streaming。它原生提供的以下能力消除了自建 wrapper 的需要：

- `contextSchema` + `toolsContext`：per-tool 类型化 context 注入
- `runtimeContext`：agent loop 内共享状态
- `prepareStep`：step 间动态更新 context/tools
- `ToolExecutionOptions.abortSignal`：原生取消支持
- 多步 tool loop，停止条件可配（`stopWhen: stepCountIs(n)`）

### 9.3 `ctx.tools` Tool Registry（未实现，设计已修订）

> ⚠️ **三层 tool 模型已废弃。** 当前设计见 [cookbook/04-tool-design.md](./cookbook/04-tool-design.md)。
> 以下接口描述已按新设计修订。

计划中的全局 Service（不 isolate），职责：

1. **注册/注销** —— 插件注册 tool；Cordis dispose 自动注销
2. **发现** —— Cortex 装配 agent loop 时收集当前作用域内可用 tool

```typescript
interface ToolRegistry extends Service {
  register(name: string, tool: CoreTool, options?: { override?: boolean }): () => void;
  available(): Record<string, CoreTool>;
}
```

不负责执行——AI SDK 直接调用 tool 的 `execute` 函数。

**作用域语义**：`ctx.tools` 不 isolate（全局一个实例），内部按 `life` isolate symbol 做作用域过滤：

```
Root Context（全局 tool 注册在此）
├── read_resource, describe_image          ← 所有 Life 可见
│
├── Alice Life Group（isolate: { life, cortex, nerve }）
│   ├── ctx.tools.register: set_essence, draw_image  ← 仅 Alice 可见
│   └── Cortex 装配: coreTools() + ctx.tools.available()
│
└── Bob Life Group（isolate: { life, cortex, nerve }）
    ├── ctx.tools.register: set_essence    ← 仅 Bob 可见
    └── Cortex 装配: coreTools() + ctx.tools.available()
```

Cortex 内置 tool 不走 Registry——Cortex 直接构造后与 `ctx.tools.available()` 合并。Registry 服务插件贡献的 tool。

---

## 10. Instance 加载机制

### 10.1 Instance 是什么

Instance 是描述**一个数字生命完整组成**的声明式 YAML 文件。用 cordis 标准的 `plugin-include` 机制实现 —— **不需要自定义 loader**。

### 10.2 目标文件结构

```
athena-harness/
├── cordis.yml                    ← bootstrap（prelude: core）
├── app.yml                       ← managed plugin tree
├── instances/
│   ├── alice.yml                 ← Alice 的 instance 定义
│   └── bob.yml
├── personas/
│   ├── alice-persona.yml
│   └── bob-persona.yml
└── data/
    ├── alice.db                  ← Alice 的 memory 存储
    └── bob.db
```

### 10.3 单 Life

```yaml
# app.yml
- name: "@cordisjs/plugin-include"
  config:
    path: ./instances/alice.yml

- name: "@cordisjs/plugin-database-sqlite"
  config: { path: ./data/athena.db }
- name: "@cordisjs/plugin-hmr"
  config: { root: [packages, plugins, instances] }
- name: "@cordisjs/plugin-webui"
```

```yaml
# instances/alice.yml
- name: "@athena-ai/plugin-life"
  config:
    persona: ./personas/alice-persona.yml
    memory: { backend: sqlite, path: ./data/alice.db }

- name: "@athena-ai/cortex-chat"
  config:
    model: deepseek:deepseek-chat
- name: "@athena-ai/nerve-onebot"
  config: { selfId: "123", endpoint: "ws://localhost:6700", protocol: ws }
```

### 10.4 多 Life

用 `plugin-group` 包裹 `plugin-include`，在 group 上声明 isolate（见 §4.3）。

### 10.5 Instance 文件是自包含的

一个 instance 文件是**完整、可移植的 Life 定义**，可以：

- 在部署间共享（复制 `instances/alice.yml` 到另一台机器）
- 独立版本控制
- 经 HMR 热重载（若 `instances/` 在 HMR watch list 中）
- 由 WebUI 管理（经 plugin-include → entry 出现在插件树中）

### 10.6 不做自定义 Instance Loader

Instance 机制**只**用 cordis 标准原语：`plugin-include`（文件引用）、`plugin-group`（作用域）、`isolate` config（service 隔离）。

这是有意选择：留在 cordis 标准机制内保证了 WebUI 兼容、HMR 支持、零维护负担。

> ⚠️ **当前状态**：`instances/` 与 `personas/` 目录尚不存在；`Life._resolvePersona()` 仅支持 inline object，文件加载抛 `Persona file loading not yet implemented`。

---

## 11. Vendored 依赖（历史）

### 11.1 历史

项目早期 vendor 了 Satori v5（`vendor/satorijs/*`）与 `@cordisjs/url-is-local`，用于 IM 协议与 adapter 生态。**2026-08 已整体移除**：

| 曾 vendored 的包           | 去向                                          |
| -------------------------- | --------------------------------------------- |
| `@satorijs/core`           | 由 `@athena-ai/protocol` + `protocol-im` 替代 |
| `@satorijs/protocol`       | 类型并入 `@athena-ai/protocol-im`             |
| `@satorijs/element`        | 用 npm 的 `@cordisjs/element`                 |
| `@satorijs/adapter-onebot` | 由 `@athena-ai/nerve-onebot` 替代             |
| `@satorijs/adapter-qq`     | 未迁移（QQ 官方 adapter 待自研）              |
| `@satorijs/adapter-satori` | 不需要（Satori 协议服务端）                   |

**移除原因**：Nerve 协议自研完成后，Satori 生态（Bot/Adapter/Session 基类、mixin 注册表、InternalRouter）与 Athena 的"Body + NerveService + declaration merging"架构重复。保留 vendor 意味着维护两套协议、且 `ctx.mixin` 的 accessor 冲突限制多 Life 部署（见 [05-lessons-learned.md](./05-lessons-learned.md) §1）。

### 11.2 移除时的连带改动

| 位置                         | 改动                                                 |
| ---------------------------- | ---------------------------------------------------- |
| `plugins/capability-message` | 整包删除（Satori 隔离层不再需要）                    |
| `plugins/cortex-chat`        | `ctx.message` → `ctx.nerve` + `message-created` 事件 |
| `plugins/sandbox`            | `SandboxBot` 从 Satori `Bot` 迁移到 `IMBody`         |
| `plugins/sandbox-nerve`      | `ctx.satori.bots` → `ctx.nerve.get()`                |
| `package.json`               | workspaces 移除 `vendor/*/*`                         |

### 11.3 教训

- **不要在 vendor 大生态（Satori/Koishi）上构建自己的抽象**——迁移成本会随时间增长
- 自研协议时保持极薄：`protocol`（无 IM 语义）+ `protocol-im`（IM 增强，declaration merging）的拆分让"删掉 Satori"变成纯增量替换
- `ctx.satori.bots` / `ctx.message` 等旧 API 在文档中的残留引用需要系统性清理

---

## 12. 架构不变式清单

修改代码时必须保持的性质：

1. **Cortex 只通过 `cordis.Events` 消费事件**（`message-created` 等），发送通过事件上的 `body` 引用
2. **Cortex 依赖 `protocol` / `protocol-im` 类型，永不依赖 `nerve-*` / adapter 包**
3. **每个 Life 至多一个 Cortex**（由 `Life.bind()` 强制）
4. **框架不提供 event→response 管道**（无 middleware chain、无 command routing）
5. **Cortex 自管理事件缓冲**（框架不提供 queue/inbox/mailbox）
6. **没有 Service 在构造函数中调用 `ctx.mixin()`**（除非确定全进程单实例）
7. **Multi-Life 隔离 `{ life, cortex, nerve }` 三个 key**
8. **IM 平台接入统一继承 `IMBody`**，不引入平行实现（如直接嵌 Satori）
9. **不在 AI SDK 之上加 LLM 抽象层**
10. **Instance 机制只用 cordis 标准原语**
11. **`cordis` 永远在 `peerDependencies`**
12. **事件签名只在 `cordis.Events` 声明一份**，不维护平行事件映射表
