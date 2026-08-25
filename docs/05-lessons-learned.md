# 经验教训

> 本文记录已经付出代价换来的结论。**改动前先读这里** —— 很多"看起来更简洁"的写法在这里已被否决过。
>
> 每条包含：**现象** → **根因** → **结论**。附证据路径供核验。

---

## 1. Cordis v4 隔离的真实边界

### 1.1 现象

多 group 部署（Alice + Bob，各含 `capability-message`）时抛出：

```
property "bots" is already declared as accessor
```

即使两个 group 都声明了 `isolate: { satori: true, bots: true }`。

### 1.2 根因链

1. 每个 group 内 `MessageService` 构造函数调 `ctx.plugin(Satori)`
2. `Satori` 构造函数调 `ctx.mixin('satori', ['bots', 'component'])`
3. `mixin` 内部对每个 key 调 `accessor('bots', { get, set })`
4. `accessor` 检查 `if (name in this.props)`
5. **`this.props` 是 root `ReflectService` 上的单例字典**
6. 第一个 Satori 成功：`props['bots'] = { type: 'accessor', ... }`
7. 第二个 Satori 发现 `props['bots']` 已存在 → **抛错**

### 1.3 根本原因

**`accessor` / `mixin` 在全局命名空间（`props` 字典，字符串键）注册属性描述符。`isolate` 只隔离 service 实例（`store` 字典，Symbol 键）。**

| 机制                   | 注册位置                    | 键类型     | 受 isolate 影响 |
| ---------------------- | --------------------------- | ---------- | --------------- |
| `provide(name, value)` | `store[ctx[isolate][name]]` | **Symbol** | ✅              |
| `accessor(name, opts)` | `props[name]`               | **String** | ❌              |
| `mixin(source, keys)`  | 逐 key 调 `accessor`        | **String** | ❌              |

因此 `isolate: { bots: true }` 对 accessor 冲突**零效果**。

### 1.4 结论

> **任何在构造函数中调用 `ctx.mixin()` 的 Service，在整个 cordis 进程中只能有一个存活的 fiber。**

accessor 的 effect-dispose（`delete this.props[name]`）只在 fiber 销毁时运行。两个 fiber 共存期间，第二次注册必然抛错。

**这不是 cordis 的 bug，是设计选择。** mixin/accessor 被设计为全局注册一次，提供统一的属性接口。它们委托的 service 是 isolate-aware 的 —— 所以 mixin getter 在不同隔离域中自然返回不同值 —— 但 getter 本身只能注册一次。

### 1.5 采取的行动

删除 vendored Satori 的 mixin 调用：

| 位置                                          | 修改                                                                             |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `vendor/satorijs/core/src/index.ts`           | 删除 `ctx.mixin('satori', ['bots', 'component'])`                                |
| `vendor/satorijs/core/src/bot.ts`             | `ctx.bots` → `ctx.satori.bots`（constructor / dispose / status setter，共 3 处） |
| `vendor/satorijs/adapter-qq/src/bot/index.ts` | `ctx.bots` → `ctx.satori.bots`（stop 方法）                                      |
| `plugins/sandbox/src/index.ts`                | `ctx.bots` → `ctx.satori.bots`（ensureBot）                                      |

**后果**：`ctx.bots` 与 `ctx.component` 在 Athena 中**不存在**。一律用 `ctx.satori.bots`。

### 1.6 对新代码的约束

- **不要**在任何 Service 构造函数中调 `ctx.mixin()`，除非你能保证全进程单实例
- 需要"快捷属性"时，用普通 getter 或让调用方写 `ctx.<service>.<prop>`
- 引入新的第三方 cordis Service 前，**先 grep 它有没有 `mixin` / `accessor` 调用**

### 1.7 证据

- `references/cordis/packages/core/src/reflect.ts:229-236` —— accessor 冲突检测
- `references/cordis/packages/core/src/reflect.ts:239-264` —— mixin 调用 accessor
- `references/cordis/packages/core/src/reflect.ts:136` —— props 是单例
- `references/cordis/packages/core/src/context.ts:65-69` —— isolate 实现
- `.specify/specs/multi-life-isolation-design.md` §1, §2, §6

---

## 2. `provide` 不能重复：为什么四个 token 都要隔离

### 2.1 现象 A：未隔离 cortex

```
service "cortex" has been registered at <CortexChat>
```

**根因**：两个 group 的 `ctx[Context.isolate]['cortex']` 指向同一个 root symbol。第一个 `provide('cortex', self)` 写入 `store[rootSymbol]`；第二个发现该 slot 已占用 → 抛错（`reflect.ts:187-188`）。

### 2.2 现象 B：隔离了 cortex 但 Life 在 prelude

```
Only one Cortex per Life
```

**根因链**：

1. 加了 `isolate: { cortex: true }` → 每 group 不同 cortex symbol → `provide` 不再冲突 ✅
2. **但 Life 安装在 prelude（`cordis.yml`）→ 全进程只有一个 Life 实例**
3. 两个 CortexChat 都 `inject ['life']` → 拿到**同一个** Life
4. 第一个：`life.bind(this)` → `_cortex = cortexA` ✅
5. 第二个：`life.bind(this)` → `_cortex` 已设置 → **抛错**

### 2.3 结论

Life **必须**是 per-group 的 managed plugin，**不能**放在 prelude。这是 `@athena-ai/core`（prelude shell）与 `@athena-ai/plugin-life`（per-group service）分家的直接原因。

四个 token 缺一不可：

| Token     | 不隔离的后果                                      |
| --------- | ------------------------------------------------- |
| `life`    | 共享 Life → 第二个 Cortex `bind()` 抛错           |
| `cortex`  | `provide('cortex')` 冲突                          |
| `message` | MessageService 冲突 + 事件作用域过滤失效          |
| `satori`  | `provide('satori')` 冲突；adapter 无法区分 domain |

### 2.4 证据

- `plugins/life/src/life.ts:35-46` —— `bind()` 检查
- `.specify/specs/multi-life-isolation-design.md` §1.2, §1.3

---

## 3. Cordis Proxy identity 陷阱

### 3.1 现象

存了 service 引用后，用 `===` 比较时意外为 `false`；disposer 清错了对象。

### 3.2 根因

Cordis 用 Proxy 包装 service 实例做 context 重绑定。**`serviceA === serviceB` 可能为 `false`，即使它们代表同一个底层对象。**

### 3.3 结论

**存 service 引用时，按 `.name`（或其他稳定标识）比较，不按 identity。**

```typescript
bind(cortex: Service): () => void {
  if (this._cortex) throw new Error(`Only one Cortex per Life. ...`);
  this._cortex = cortex;
  const name = cortex.name;                    // ← 捕获稳定标识
  return () => {
    if (this._cortex && this._cortex.name === name) {
      this._cortex = null;                     // 只清自己绑的那个
    }
  };
}
```

这个 disposer 还顺带解决了热重载场景：旧 disposer 迟到触发时不会误清新绑定。测试用例 `disposer ignores if already rebound` 就是覆盖它。

### 3.4 关联陷阱：`this.ctx` 被重绑定

同一套 Proxy 机制会在 service 通过 traceable proxy 被访问时（如从 root `ctx.get("message")`）把 `this.ctx` 重绑到调用方 context。若逻辑依赖构造时的 context（解析 isolate symbol、查特定 domain 的 service），**必须自存引用**：

```typescript
private _self: Context;

constructor(ctx: Context) {
  super(ctx, "message");
  this._self = ctx;      // ← 不要依赖 this.ctx
}

get bots() {
  return this._self.get("satori")?.bots ?? [];
}
```

### 3.5 关联陷阱：traced proxy 让 `.ctx` 指向接收方

`Session` 和 `Bot` 都声明了：

```typescript
public[Service.tracker] = { associate: "session", property: "ctx" };
```

这使得 `session.bot.ctx` 解析为**接收方**的 context，而非拥有该 bot 的 context。

**后果**：MessageService 若直接用 `session.bot.ctx` 判断 session 归属，**每个实例都会认领每个 session**（最后写入者胜出）。

解法是先 unwrap：

```typescript
const ORIGINAL = Symbol.for("cordis.original");

function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}

// 使用
const bot = unwrap(session.bot);
if (!bot || bot.ctx[Context.isolate]["satori"] !== satoriSymbol) return;
```

### 3.6 证据

- `plugins/capability-message/src/index.ts:13-24, 31-39, 54-68`
- `plugins/life/src/life.ts:40-45`
- `plugins/life/tests/life.test.ts:53-67`
- `.specify/specs/multi-life-isolation-design.md` §6

---

## 4. 从 pull-based 到 push-based

### 4.1 曾经的设计

`spirit-pulse-medium-domain-model.md` 与 `capability-protocol-and-entity-model.md` 曾把 pull-based 写成**强制要求**：

> **FR-004**：Capability 事件投递 **MUST** 是 pull-based（可订阅源 + Mode 自有 inbox），而非 push-based 广播。Mode 控制 drain 节奏。
>
> **FR-005**：事件投递到 Mode 的 inbox **MUST** 默认串行化 —— 除非 Mode 显式选择并行，不允许并发 `handle()` 调用。

配套设计了 framework 级的 Sense Queue / Inbox 抽象。

### 4.2 为什么被推翻

1. **与底层基础设施逆向** —— Cordis 与 Satori 原生 push（`Bot.dispatch → ctx.emit`）。在 push 之上造 pull 层，只是把复杂度搬家，并额外引入一层需要维护的抽象。

2. **三种 Cortex 的缓冲策略无共同抽象**：
   - Chat：willingness 计算 → 阈值触发 → 短聚合窗口
   - World：mailbox → heartbeat drain
   - Interlude：debounce buffer → 阈值 drain

   窗口长度、触发条件、聚合逻辑都是产品语义。任何统一的 queue 抽象都会同时对三者过度约束又都不够用。

3. **与既有原则冲突** —— "调度是 Cortex 内部的事"这条设计原则，同样适用于事件消费。事件消费策略就是调度策略的一部分。

4. **强制串行化的代价** —— FR-005 要求框架保证串行，但串行粒度（per-channel？per-Life？全局？）同样是产品决定。World Cortex 的 heartbeat 天然串行；Chat Cortex 需要 per-channel 串行但跨 channel 并发。框架无法选对。

### 4.3 最终形态

Nerve（经 Capability）发射 Cordis 事件；Cortex 用 `ctx.on(...)` 订阅并自管理消费策略。**框架不提供任何 queue / inbox / mailbox 抽象。**

### 4.4 代价与补偿

代价是**没有天然串行保证**。补偿：

- Cortex 自己实现串行队列 / 状态锁 / 幂等设计（见 [04-patterns-and-recipes.md](./04-patterns-and-recipes.md) §8.9）
- 多 Life 事件不串台由 `[Context.filter]` 作用域过滤保证，**这部分框架管**

### 4.5 一般化教训

> **不要在与底层基础设施语义相反的方向上造抽象。** 若底层是 push，就在 push 之上表达；若底层是 pull，就在 pull 之上表达。逆向包装的成本会持续偿还，且往往在多产品共存时暴露为"对所有人都不合适"。

### 4.6 证据

- `.specify/specs/spirit-pulse-medium-domain-model.md` 顶部 supersession notice、L112
- `.specify/specs/satori-capability-architecture.md` D-05
- `.specify/specs/naming-and-package-architecture.md` D-28

---

## 5. 三代命名与建模的演进

### 5.1 第一代：Body / BodyAdapter / BodyRegistry

**做法**：Life 通过字符串 ID 挂载 Body：`life.attachBody("onebot")`。

**为什么失败**：

- **反 Cordis** —— 命令式挂载，需要带外知识（ID 从哪来？）
- **N:M 语义混乱** —— 一个 Body 服务多个 Life？一个 Life 多个 Body？规则说不清
- **迫使上层知道 adapter 特定标识符** —— 破坏平台无关性

**结论**：**ID-based wiring 被否决。** 组合必须是 Cordis 原生的 —— 在正确 scope 安装插件，它们通过 service / capability 图自动发现彼此。零命令式接线调用。

### 5.2 第二代：Capability Protocol / Adapter / Mode

**做法**：定义抽象 Capability Protocol（sense 契约 + act 契约 + state 契约 + feature flag），Adapter 声明实现哪些 protocol，Mode 声明需要哪些。

**保留下来的**：依赖倒置思想（消费者依赖契约而非实现）、feature negotiation 概念、Mode 作为整体可替换单元。

**被推翻的**：

- **pull-based sense queue**（见 §4）
- **自建 protocol 定义机制** —— 后来发现 Cordis Service + `inject` 已经是这个机制，不需要在它之上再造一层
- **"Adapter" 这个名字** —— 暗示单向格式转换，与双向导管语义不符

**关键领悟**：我们曾以为需要发明"Capability Protocol 定义机制"，实际上 **Cordis Service 的 provide key 就是 capability token，`inject` 就是契约声明**。整个机制免费拿到。

### 5.3 第三代：Life / Cortex / Nerve（当前）

| 责任     | 名字       | 理由                                                                                                     |
| -------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| 持续身份 | **Life**   | 直接映射产品目标（数字生命框架）；v1 原名，直觉最强                                                      |
| 生存策略 | **Cortex** | 解剖学准确 —— 大脑皮层负责感知整合、决策、运动规划、时间控制；**不**暗示可切换性（你不会热插拔一个皮层） |
| 世界接口 | **Nerve**  | 与 Cortex 解剖学关系正确；双向导管（感觉神经进、运动神经出）；粒度正确（一条 nerve = 一条完整连接通路）  |

同时确立：

- **Instance** 取代 "Life Config"（部署配置）
- **Preset** 表示 Cortex 内部行为切换（延后）

### 5.4 命名迁移表

阅读旧文档时按此翻译：

| 旧术语                              | 新术语        |
| ----------------------------------- | ------------- |
| Spirit                              | Life          |
| Pulse / Mode                        | Cortex        |
| Medium / Body / Adapter（作为原语） | Nerve         |
| Life Config                         | Instance      |
| Pulse preset                        | Cortex Preset |

### 5.5 教训

> **命名迭代不是浪费。** 三代命名各自暴露了建模错误：Body 暴露了 ID wiring 的问题；Capability Protocol 暴露了"重复发明 Cordis 已有机制"的问题；Life/Cortex/Nerve 才在隐喻上自洽。
>
> 但**命名稳定后就不要再改** —— 当前命名已在 `.specify/specs/` D-20 定稿，代码已全面采用。

### 5.6 证据

- `.specify/specs/capability-protocol-and-entity-model.md`（整篇 SUPERSEDED，保留作演进记录）
- `.specify/specs/naming-and-package-architecture.md` D-20, D-21, §Superseded Naming

---

## 6. 不要包装已经好用的抽象

### 6.1 案例 A：不包装 Satori

**曾考虑**：自建 `capability-messaging` 接口，把 Satori 藏在后面，只暴露 `send(target, content)` 这类最小抽象。

**否决理由**：

- Satori 已提供完整成熟的 IM 操作集（`Methods` 40+ 操作：message / channel / guild / reaction / role / friend / upload）
- 20+ 平台 adapter 直接可复用
- 自建最小抽象 = **最小公约数陷阱**：平台特有能力（OneBot 的精华消息、Discord 的 thread）无处安放
- `bot.features` 已提供运行时能力发现，无需编译期耦合
- `@satorijs/protocol` 的类型已是业界标准

**最终做法**：`capability-message` **重导出** Satori 类型，`ctx.message.bots` 直接暴露 `Bot[]`，Cortex 可直接调 `bot.getMessageList()`。只在 MessageService 上加**便捷方法**（单 bot 场景免去寻址），不做代理墙。

**收益**：Cortex 开发者学的是 Satori —— 一个有文档的已知框架，技能可迁移；而非一套 bespoke 接口。

### 6.2 案例 B：不包装 AI SDK

**曾有过**：YesImBot v4 的 `agent-runtime` 与早期 `harness-core` 都在重复 AI SDK 已提供的东西（tool 执行上下文、多步循环、取消机制）。

**否决理由**：AI SDK v7 原生提供

- `contextSchema` + `toolsContext`：per-tool 类型化 context 注入
- `runtimeContext`：agent loop 内共享状态
- `prepareStep`：step 间动态更新 context/tools
- `ToolExecutionOptions.abortSignal`：原生取消
- 多步 tool loop，停止条件可配（`stopWhen: stepCountIs(n)`）

自建 wrapper = 用更不成熟的实现重复同样的功能。

**最终做法**：Cortex 直接调 `generateText` / `streamText` / `tool`。框架**不**在 Cortex 与 AI SDK 之间做中介。`AIService`（`ctx.ai`）只负责 **provider 注册与模型解析**（这是 AI SDK 不管的部分），解析结果直接是 AI SDK 的 `LanguageModelV4` —— 连默认参数注入都用 AI SDK 自己的 `defaultSettingsMiddleware`，而非自建合并逻辑。

### 6.3 案例 C：不自建 Instance Loader

**曾计划**：`@athena-ai/instance-loader` 解析 `instances/*.yml`。

**否决理由**：cordis 标准原语已够用 —— `plugin-include`（文件引用）+ `plugin-group`（作用域）+ `isolate` config（service 隔离）。

**收益**：WebUI 兼容、HMR 支持、零维护负担。自建 loader 会立刻失去这三项。

### 6.4 案例 D：不自建 CLI

**曾计划**：`@athena-ai/cli` 提供 `athena start`。

**否决理由**：独立性判据不是"有品牌 CLI"，而是"有定义框架身份的 prelude 级内核"。`cordis run` + prelude 中的 `@athena-ai/core` 已满足全部实质要求（不可卸载、WebUI 中不可见、所有插件依赖它）。

**收益**：零工程投入在 CLI 打包上，专注框架实质。未来加品牌 CLI 只需换入口二进制，架构零改动。

### 6.5 案例 E：不自建事件过滤机制

**曾考虑**：在 capability 层做事件路由表，按 Life ID 分发。

**否决理由**：Cordis 原生 `[Context.filter]` 就是这个机制，且 Koishi 已用它做 platform/channel 过滤，路径经过验证。

**最终做法**：MessageService 在 `internal/session` 上注入 filter，比较 isolate symbol。差异只在**用途**：Koishi 用它做内容过滤（哪个 channel），Athena 用它做作用域隔离（哪个 Life 拥有此事件）。

### 6.6 一般化判据

新增抽象层之前，逐条问：

1. 下层是否已提供这个能力？（先读源码，不要凭印象）
2. 我的抽象是否会造成**最小公约数**损失？
3. 学我的抽象 vs 学下层，哪个对开发者更有价值？
4. 我的抽象是否会阻断下层的生态（adapter、插件、工具链）？
5. 若下层演进，我的抽象是资产还是负债？

**只有当抽象带来下层不可能提供的收益（如隔离、多实例、作用域）时才值得。** `capability-message` 的价值不在"包装 Satori"，而在"提供隔离与作用域"—— 这是 Satori 本身不管的事。

### 6.7 证据

- `.specify/specs/satori-capability-architecture.md` §Design Philosophy, D-01, D-06
- `.specify/specs/technology-selection-and-tool-architecture.md` D-09, D-13
- `.specify/specs/capability-message-design.md` §3.2, M-03, M-08, M-12, M-19
- `.specify/specs/multi-life-isolation-design.md` §3.6

---

## 7. Koishi 源码的教训

读 `YesImBot/node_modules/@koishijs/core/src` 得到的结论。

### 7.1 `Context extends satori.Context` —— 身份绑定过紧

```typescript
// @koishijs/core/src/context.ts:50
export class Context extends satori.Context { ... }
```

**后果**：

- 每个 Koishi context **就是**一个 Satori context
- `ctx.satori`、`ctx.bots` 处处可见，对所有插件可见
- **框架身份即 messaging** —— 没有 Satori 无法使用 Koishi
- 无法构造一个不含 messaging 的 Koishi 进程

**教训**：**内核不要继承某个领域实现的基类。** 一旦继承，该领域就成为框架身份，其他领域永远是二等公民。Athena 的 `Context` 是原生 cordis `Context`，Satori 在 capability 内部。

**代价**：Athena 需要显式 `inject: ['message']` 才能访问 IM，写起来比 Koishi 的"到处都有 `ctx.bots`"啰嗦。这是**有意付出的代价** —— 换来的是"messaging 可移除"和"多 capability 平权"。

### 7.2 Session 是一次性快照

Koishi 的 `Session` 是"消息到 → 处理 → 回复 → 结束"的快照。

**无法表达**：

- 超越单个 Session 生命周期的持续状态
- "我正在进行一项长时间活动"
- 没有消息时的存在

**教训**：**不要让"事件对象"承载状态。** Athena 中 Session 只是感知输入，状态归 Life（长期）与 Cortex（当次策略内部）。

### 7.3 Middleware chain 强制 event→response

Koishi 的 middleware chain 是线性 input→transform→output 管道。Command system 是 request/response。

**后果**：自主行为（无外部事件触发的行动）成为架构上的异类。timer 插件能伪造自主性，但框架的生命周期管理、资源分配、可观测性都不为"无提示计算"做打算。

**教训**：**框架不提供 event→response 管道。** Athena 提供零个 IM 专用框架流程。Cortex 完全自决如何响应或不响应。"不回复"是一等决策，"主动行动"是一等行为。

### 7.4 值得借鉴的部分

不是全盘否定 —— 以下 Koishi 做法值得参考：

| Koishi 做法                   | 我们的态度                            |
| ----------------------------- | ------------------------------------- |
| `[Context.filter]` 做事件过滤 | ✅ 直接复用机制（改用途为作用域隔离） |
| prelude 级 core 定义框架身份  | ✅ 完全相同的结构                     |
| `app.yml` 声明式插件树        | ✅ 复用 cordis loader                 |
| Command / permission 系统实现 | 🔸 未来若需要，可参考实现细节         |
| 成熟的 adapter 生态           | ✅ 通过 Satori 直接复用               |

**共享基础设施是优势，不是弱点。** 区分框架的是组织原则，不是砖块。

### 7.5 证据

- `YesImBot/node_modules/@koishijs/core/src/context.ts:50, 128`
- `.specify/specs/design-philosophy-and-positioning.md` §vs Koishi
- `.specify/specs/capability-message-design.md` Part VI

---

## 8. Satori v4 → v5 的迁移经验

### 8.1 版本差异要点

| 方面           | Satori v4（stable）                                                         | Satori v5（alpha，我们用的）        |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Cordis 依赖    | `^3.18.1`                                                                   | `^4.0.0-rc.3`                       |
| npm 发布       | 是（`@satorijs/core@4.6.0`）                                                | **否**（未发布）                    |
| Service 注册   | `static [Service.provide] = 'satori'` + `static [Service.immediate] = true` | `super(ctx, 'satori')`（v4 新模式） |
| Bot 生命周期   | `static reusable = true` + 手动 `start()/stop()`                            | `*[Service.init]()` generator       |
| Context 泛型   | `Satori<C extends Context>`                                                 | `Satori`（无泛型，更简单）          |
| InternalRouter | 自定义 HTTP 方法式                                                          | 标准 `Request`/`Response` API       |
| HTTP 集成      | `ctx.on('http/file', ...)`                                                  | `ctx.on('http/fetch', ...)`         |
| Adapter 架构   | 相同抽象模式                                                                | 相同抽象模式                        |
| Bot.dispatch   | 相同事件发射模式                                                            | 相同事件发射模式                    |

### 8.2 为什么必须用 v5

**Satori v4 依赖 cordis v3，与我们的 cordis v4 root 存在 context tree 不兼容。** 这不是可以绕过的兼容性问题 —— 两个 cordis 大版本的 Context 是不同的类。

因此选项只有：

1. 用 Satori v5 alpha（vendored，因为未发布）✅ 采用
2. 全项目降级到 cordis v3 ❌ 放弃 v4 的 Service/Fiber 改进
3. 自己实现 IM 层 ❌ 约 400 行核心 + 全部 adapter

### 8.3 为什么 vendor 而非 npm 依赖

- Satori v5 **未发布**到 npm（无 `next` tag，无 alpha release）—— 没有可依赖的版本
- Vendor git snapshot 是经验证模式（deepseek-harness 就 vendor 了 cordis 组件）
- **我们控制版本** —— 上游 alpha 变动不会意外破坏我们
- 需要打补丁时（如移除 mixin）可以直接改

### 8.4 vendor 的维护负担

**已知未解决问题**：追踪上游变更并选择性合并的流程尚未确立。当前状态是"快照 + 本地补丁"，没有自动化的 upstream diff 机制。

补丁清单必须**手工维护**在 [02-architecture.md](./02-architecture.md) §11.3。每次改 vendored 代码都要登记，否则未来同步上游时会丢失。

### 8.5 IM 连通策略：Satori Protocol Bridge

初期不直接对接平台，而是桥接到已有的 Koishi 实例：

```
Koishi 实例（Cordis v3 + Satori v4）
  ├── adapter-onebot（连 Napcat/LLOneBot）
  ├── adapter-discord / -telegram / ...
  └── @koishijs/plugin-server（暴露 Satori Protocol API）
         │
         │  HTTP + WebSocket（Satori Protocol）
         ▼
Athena Runtime（Cordis v4 + Satori v5 vendored）
  └── @satorijs/adapter-satori
         → Bot 实例出现在 ctx.satori.bots
         → 事件经 Cordis 事件系统推送
         → Cortex 正常消费
```

**收益**：

- 现有 Koishi/adapter-onebot 部署**零改动**
- 立刻获得 Koishi 支持的所有平台
- Satori Protocol 是定义良好的 wire protocol，部署上隔离
- 避开了"为 Satori v5 fork 每个 adapter"的短期阻塞

**长期演进**：core 稳定后可 fork adapter-onebot 或写原生 Satori v5 adapter，消除 Koishi bridge 依赖。仓库中已 vendored `adapter-onebot` 与 `adapter-qq`，说明这一步已在进行。

### 8.6 证据

- `.specify/specs/capability-message-design.md` Part II
- `.specify/specs/technology-selection-and-tool-architecture.md` D-11, D-12
- `references/satori/` vs `references/satori-v4/`

---

## 9. Tool Context 注入：三次失败的设计

### 9.1 YesImBot v3：session 直接合进参数

```typescript
interactions.register({
  name: "ban_user",
  parameters: {
    session: SessionType, // 框架注入触发的 session
    user_id: z.string(),
  },
  execute: async ({ session, user_id }) => {
    await session.bot.internal.setGroupBan(session.guildId, user_id, 600);
  },
});
```

**问题**：tool 绑定到单个 session/channel，无法跨 channel 操作。

### 9.2 YesImBot v4（agent-runtime）：ExecuteContext 作为第二参数

```typescript
interface AgentToolExecuteContext {
  channel: ChannelMetadata;
  state: StateManager;
  storage: StorageInterface;
  messages: Message[];
  abortSignal: AbortSignal;
}
```

**问题**：假设一次执行 = 一个 channel。World / Narrative Cortex 聚合多个 channel。

### 9.3 YesImBot v4（onebot-utils）：工厂函数闭包绑定

```typescript
function createOneBotTools(ctx, bot, config, scope, resources) {
  return {
    set_essence: tool({
      execute: async ({ messageId }) => {
        await bot.internal.setEssenceMsg(messageId); // bot、scope 由闭包捕获
      },
    }),
  };
}
```

**问题**：tool 在创建时绑定到特定 bot + scope，无法动态寻址不同 bot。

### 9.4 共同的错误假设

三者都假设：**"一次 agent 执行 = 一个 channel = 一个 bot"**。

### 9.5 Athena 的解法：在架构层打破这个假设

- Life 是**全局**的（不是 per-channel）
- Cortex 可能同时消费来自多个 channel 的事件
- **LLM 决定**用哪个 bot、发到哪个 channel
- Tool 是无状态函数，通过**参数**接收完整寻址信息

```typescript
send_message: tool({
  inputSchema: z.object({
    channelId: z.string(),
    content: z.string(),
    botSid: z.string().optional(), // 单 bot 时可省
  }),
  // 用单个 `input`，不要解构 —— 解构 + 转发可选字段会破坏 TS 推导
  // 详见 04-patterns-and-recipes.md §5.2「类型推导陷阱」
  execute: async (input) => {
    // 通过闭包中的 ctx 访问 service —— service 是活引用
    const ids = await ctx.message.sendMessage(input.channelId, input.content, input.botSid);
    return { messageIds: ids };
  },
});
```

**因此不需要 tool context 注入。**

### 9.6 为什么这在 Athena 可行而在 v3/v4 不可行

|                | v3/v4                         | Athena                           |
| -------------- | ----------------------------- | -------------------------------- |
| Agent 粒度     | per-channel 隔离              | per-Life 全局                    |
| Bot 关系       | 一 agent = 一 bot、一 channel | 一 Cortex = 多 bot、所有 channel |
| "当前 channel" | 隐含前提，总是存在            | **不作为概念存在**               |
| Tool 寻址      | 注入 / 闭包绑定的 target      | LLM 通过参数选择 target          |
| 注入动机       | 隔离 = 安全 + 简化            | 无需隔离 = 无需注入              |

v3/v4 注入 channelId 是**安全措施**（防止跨 channel 操作）；Athena 的 Life 需要跨 channel 操作（"根据 QQ 事件在 Discord 回复"）。LLM 已知完整上下文，能正确选择目标；Cortex 通过 prompt 引导。

### 9.7 遗留的开放问题

Bot 归属强制未解决：框架是否应阻止 Life A 使用 Life B 的 bot？当前依赖 prompt 级引导 + isolate（Life A 的 `ctx.message` 里根本没有 Life B 的 bot）。isolate 实际上提供了物理隔离，但同 Life 内的多 bot 之间无约束。

### 9.8 证据

- `.specify/specs/technology-selection-and-tool-architecture.md` D-14, D-15, Part IV

---

## 10. `core` 包边界的两次调整

### 10.1 第一版：core 含类型 + Cortex 基类 + Hook 声明

`capability-message-design.md` Part XI 设计 `@athena-ai/core` 包含：

- `Cortex` abstract class
- `MemoryProvider` / `LifeService` / `Persona` 接口
- Hook protocol 的 `declare module 'cordis'`

### 10.2 问题

Life 从 prelude 移到 per-group 后（§2.2），需要清晰区分：

- **协议层**（类型 + 基类，被所有包 import）
- **prelude shell**（进程级、不可卸载的东西）

把两者塞在一个包里，会让每个 plugin 都通过 import `core` 而间接依赖 prelude 语义。

### 10.3 第二版：拆成 protocol + core

| 包                    | 内容                                                                                                                                             | 角色                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------- |
| `@athena-ai/protocol` | `Persona` / `LifeService` / `MemoryProvider` / `SearchOptions` / `MemoryEntry`、Sandbox 契约、`Cortex` abstract class、`declare module "cordis"` | 纯协议层，无运行时              |
| `@athena-ai/core`     | 重导出 cordis / cosmokit / `Schema`，空 `apply()`                                                                                                | prelude shell，未来放预处理逻辑 |

### 10.4 当前实现

```typescript
// packages/protocol/src/index.ts
declare module "cordis" {
  interface Context {
    life: LifeService;
    sandbox: SandboxHubService;
  }
}

export { Cortex } from "./cortex.js";
export type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "./sandbox.js";
export type { LifeService, MemoryEntry, MemoryProvider, Persona, SearchOptions } from "./types.js";
```

```typescript
// packages/core/src/index.ts
export function apply(_ctx: Context) {
  // Placeholder for future prelude logic
}

export * from "cordis";
export * from "cosmokit";
export { default as Schema } from "schemastery";
```

### 10.5 遗留的不一致

1. **`Life.registerCortex` / `unregisterCortex` → `bind()` 返回 disposer**（M-25）。spec 中仍是旧签名，代码是新的。**代码为准。**
2. **`protocol` 从 `@athena-ai/core` import `Service` / `Context`**（`cortex.ts:1`、`types.ts:1`），而非直接从 `cordis`。这依赖 core 的重导出，形成 protocol → core 的依赖。可接受但略绕；若要收紧，protocol 应直接依赖 `cordis`。
3. **`declare module "cordis"` 分散在多处** —— `protocol`（life、sandbox）、`capability-message`（message）、`cortex-chat`（cortex）、`ai`（ai）。这是 cordis 生态的标准做法（就近声明），但意味着**类型可见性依赖 import**：不 import 对应包就看不到该 service 的类型。用空 type-import 解决：`import type {} from "@athena-ai/capability-message"`。

### 10.6 教训

> **包边界应按"依赖谁"划分，不按"内容像什么"划分。** 类型与基类被所有人 import → 独立的 protocol 包。prelude 语义只与进程启动相关 → 独立的 core 包。把两者混在一起会让依赖图失真。

### 10.7 证据

- `.specify/specs/capability-message-design.md` Part XI, M-15, M-16
- `.specify/specs/multi-life-isolation-design.md` M-22, M-23, M-25
- `packages/protocol/src/`、`packages/core/src/index.ts`

---

## 11. 全局资源与 per-Life 状态的分离

### 11.1 现象

Sandbox 插件在多 Life 部署中崩溃：

- WebUI 页面路由 `/sandbox` 被注册多次 → 冲突
- 每个 group 的 SandboxBot 使用相同 platform 标识 → bot domain 冲突
- 全局 WebSocket 监听器（`sandbox/send-message` 等）被注册多次

### 11.2 根因

一个插件同时持有两类资源：

| 资源类型     | 例                               | 正确的实例数 |
| ------------ | -------------------------------- | ------------ |
| **全局唯一** | WebUI 页面、HTTP 路由、WS 监听器 | 每进程 1 个  |
| **per-Life** | SandboxBot、会话状态             | 每 Life 1 组 |

把它们放在同一个插件里，无论怎么配 isolate 都会有一半出错。

### 11.3 解法：Hub + Nerve 分离

```
Root Context
└── SandboxHub（inject: ['webui']，provides 'sandbox'）
      ├── 注册 /sandbox 页面（一次）
      ├── 文件服务器 /sandbox/file（一次）
      ├── WS 监听器（一次）
      ├── registry: Map<lifeId, SandboxNerveHandle>
      └── 按 lifeId 路由 → nerve.dispatch(payload)

Life Group（isolate: { life, cortex, message, satori }）
└── SandboxNerve（inject: ['sandbox', 'satori', 'life']）
      ├── 以 lifeId 向 Hub 注册
      └── 在本地 ctx.satori 创建 SandboxBot
```

配套决策：

- 所有 `sandbox/*` wire frame 携带 `lifeId`，单个 WebSocket 多路复用（M-28）
- Hub 在 dispatch payload 中传 `MessageSink`，Nerve/Bot 不依赖 WebUI 内部；Hub 自动在回复上打 lifeId（M-29）
- **`sandbox` 不进 group isolate 清单** —— Hub 是全局的，Nerve 从 root 正常 inject（M-30）

### 11.4 一般化的判据

设计插件时先问：**它持有的资源里，哪些是每进程一份，哪些是每 Life 一份？**

若两者都有 → **拆成 Hub + Nerve**：

- Hub 在 root，provide 一个 token，持有全局资源，维护 `Map<lifeId, Handle>`
- Nerve 在 group，inject Hub 的 token + 本地实现 token + `life`
- Nerve 向 Hub 注册句柄，Hub 返回 disposer
- 跨边界传递用**接口**（如 `MessageSink`），不传具体实现对象
- 所有跨边界消息携带 `lifeId`

### 11.5 这个模式的复用面

未来的 capability 大概率需要同样拆分：

| Capability   | 全局部分                        | per-Life 部分                |
| ------------ | ------------------------------- | ---------------------------- |
| `minecraft`  | 服务器连接池、协议监听端口      | 每 Life 的玩家实体、视野状态 |
| `audio`      | 音频设备、编解码器              | 每 Life 的音轨、TTS 会话     |
| `expression` | Live2D 渲染进程、WebSocket 端口 | 每 Life 的模型实例、表情状态 |

### 11.6 证据

- `.specify/specs/multi-life-isolation-design.md` §7, M-27~M-30
- `plugins/sandbox/src/index.ts`、`plugins/sandbox-nerve/src/index.ts`
- `packages/protocol/src/sandbox.ts`

---

## 12. 重复的 Cordis Realm

### 12.1 现象

`athena-harness/node_modules/cordis` 与部署仓库（如 `cordis-boilerplate`）的 `node_modules/cordis` 是两份物理副本。内容相同（md5 一致），但 **ESM 模块身份不同** —— `Context === Context` 为 `false`。

### 12.2 根因

`@athena-ai/*` 包被 symlink 到 `athena-harness/packages/*` 与 `plugins/*`；ESM 从**物理路径**解析依赖，于是 athena 包解析到 harness 仓库的 cordis，而部署仓库的插件解析到自己的 cordis。

### 12.3 影响

不是已报告错误的直接原因，但会导致**微妙的 Symbol 不匹配** —— `Context.isolate`、`Context.filter`、`Service.tracker` 这些 Symbol 在两个 realm 中是不同的对象，导致：

- isolate 查找失败
- 事件过滤器不生效
- service tracker 不工作

这类问题的症状是"看起来配置正确但就是不工作"，极难定位。

### 12.4 处置

在部署仓库的 `package.json` 中加 `resolutions` 强制单一解析：

```json
{
  "resolutions": {
    "cordis": "^4.0.0-rc.8"
  }
}
```

并保持 `cordis` 在所有 athena 包中是 `peerDependencies`（而非 `dependencies`）。

### 12.5 教训

> **任何依赖 Symbol 身份的库都必须是单实例。** 对 cordis 而言这意味着：始终 `peerDependencies`，部署侧用 `resolutions` 兜底。遇到"配置看起来对但不生效"的诡异问题时，**先查有几份 cordis**。

排查命令：

```bash
find . -path '*/node_modules/cordis/package.json' -not -path '*/node_modules/*/node_modules/*'
```

### 12.6 证据

- `.specify/specs/multi-life-isolation-design.md` §1（Duplicate Cordis Realm）

---

## 13. 速查：容易再犯的错

| 错误                                         | 正确做法                                                                                   | 详见                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------- |
| 在 Service 构造函数调 `ctx.mixin()`          | 用普通 getter，或让调用方写 `ctx.<svc>.<prop>`                                             | §1                                            |
| 用 `ctx.bots` / `ctx.satori.bots`            | **已不存在**（vendor 移除）。用 `ctx.nerve.get(sid)`                                       | §14.3                                         |
| 用 `ctx.message`（capability-message）       | **已删除**。订阅 `cordis.Events`（`message-created`），发送用 `event.body`                 | §14.3                                         |
| 用 `===` 比较 service 引用                   | 按 `.name` 比较                                                                            | §3.3                                          |
| 依赖 `this.ctx` 解析 isolate                 | 构造时自存 `this._self = ctx`                                                              | §3.4                                          |
| 直接读 `session.bot.ctx` 判归属              | 先 `unwrap()`                                                                              | §3.5                                          |
| Life 放在 prelude                            | Life 是 per-group managed plugin                                                           | §2.2                                          |
| 少隔离一个 token                             | 三个都要：`life` / `cortex` / `nerve`                                                      | §2.3                                          |
| 在框架层做事件队列                           | Cortex 自管理缓冲                                                                          | §4                                            |
| 为"统一"而包装 Satori / AI SDK               | 直接用；只在需要隔离/作用域时加层                                                          | §6                                            |
| 内核继承领域实现基类                         | 内核用原生 cordis Context                                                                  | §7.1                                          |
| 让事件对象承载状态                           | 状态归 Life / Cortex                                                                       | §7.2                                          |
| tool 依赖注入的 context                      | tool 用参数接收完整寻址                                                                    | §9                                            |
| 全局资源与 per-Life 资源混在一个插件         | 拆 Hub + Nerve                                                                             | §11                                           |
| `cordis` 放 `dependencies`                   | 放 `peerDependencies` + 部署侧 `resolutions`                                               | §12                                           |
| 测试里 `await` 一个 inject 未满足的 plugin   | 不要 await，直接断言 `ctx.get(...)` undefined                                              | [04](./04-patterns-and-recipes.md) §7.1       |
| 期望 `Service<T>` 提供 `this.config`         | **不提供。** 自己写 `constructor(ctx, public config: Config)`                              | [A](./appendix/A-cordis-primer.md) §3.1       |
| `static optional = [...]`                    | cordis v4 没有。用 `ctx.get(name)` 或 `ctx.inject([...], cb)`                              | [A](./appendix/A-cordis-primer.md) §5.2       |
| `waterfall` 当 reducer 用                    | 是 `next()` 中间件链；调用方要传链尾 `inner`                                               | [A](./appendix/A-cordis-primer.md) §6.3       |
| `generateText({ maxSteps })`                 | `ai@7` 没有。用 `stopWhen: stepCountIs(n)`                                                 | [04](./04-patterns-and-recipes.md) §5.2       |
| tool 的 `execute` 解构参数                   | 用单个 `input`；解构 + 转发可选字段会破坏 TS 推导                                          | [04](./04-patterns-and-recipes.md) §5.2       |
| `models.yml` 里写 `maxTokens`                | AI SDK 的名字是 `maxOutputTokens`；写错会被 loader 丢掉并 warn                             | [04](./04-patterns-and-recipes.md) §5.7       |
| 把模型列表塞进 provider 插件的 Config        | Config 只有 `id` / `apiKey` / `baseURL`；其余进 `models.yml`                               | [04](./04-patterns-and-recipes.md) §5.5       |
| anti-slop 报 `unknown` / `any` 边界错误      | 定义 JsonValue/YamlValue 等命名域类型，避免业务参数、返回值和字典值使用逃逸类型            | [03](./03-code-conventions.md) §类型安全 lint |
| 为断言随手写 `as unknown as T`               | 优先类型谓词/`instanceof`/泛型；无法消除时在语句前写真实 `SAFETY:` 不变量                  | [03](./03-code-conventions.md) §类型安全 lint |
| 用 `Reflect.get` / `Reflect.apply` 访问实现  | 使用公开 getter、类型化属性访问或 `Function.call`                                          | [03](./03-code-conventions.md) §类型安全 lint |
| 指望 `ctx.ai` 内部帮你重试 / failover        | `candidates()` 只给排好序的候选，循环写在 Cortex 里                                        | [04](./04-patterns-and-recipes.md) §5.1       |
| 自己写代码合并模型默认参数                   | 用 AI SDK 的 `defaultSettingsMiddleware`，语义已是"调用方胜出"                             | [02](./02-architecture.md) §9.1               |
| 在 `*[Service.init]()` 里 `yield` promise    | cordis fiber 只接受 disposer 函数。异步启动用 fire-and-forget（`this.connect()` 不 await） | §14.1                                         |
| 维护平行的 `NerveEventMap` + `cordis.Events` | 事件签名只在 `cordis.Events` 声明一份（satori/koishi 模式）                                | §14.2                                         |
| Body 子类各自手写注册到 nerve                | Body 基类提供默认 `*[Service.init]()`；子类 `yield* super[Service.init]()`                 | §14.4                                         |
| adapter 请求/响应桥用模块级全局 listeners    | 放 Internal/body 实例上（`Map<echo, {resolve, timer}>`）                                   | §14.5                                         |
| 手搓事件字段（isDirect/guildId）             | 填**嵌套数据对象**，`session()` 访问器自动推导（satori 模式）                            | §14.6                                         |

---

## 14. Satori → Nerve 迁移的踩坑记录

2026-08 完成 Satori → Nerve 完整迁移（自研 protocol-im + nerve-onebot，删除 vendor/satorijs 与 capability-message）。以下是过程中付出代价换来的结论。

### 14.1 `*[Service.init]()` 里不能 `yield` promise

**现象**：`yield this.connect()` 抛 `TypeError: Invalid effect`。

**根因**：cordis v4 的 fiber 机制中，`Service.init` generator `yield` 的值只接受 **disposer 函数**（`() => Awaitable<void>`）。`yield promise` / `yield* asyncGen` 不被支持——`safeCollect` 对 promise 走 `then` 分支后 resolve 值再被收集，最终报 Invalid effect（见 `node_modules/cordis/lib/index.js` 的 `safeCollect`）。

**结论**：异步启动副作用用 **fire-and-forget**（不 await）：

```typescript
*[Service.init]() {
  const unregister = this.ctx.nerve.register(this);
  yield unregister;
  yield () => { this.disconnect(); };
  this.connect(); // fire-and-forget，连接状态机内部推进
}
```

### 14.2 事件注册表只能有一份

**现象**：`NerveEventMap`（protocol 上）和 `cordis.Events`（cordis 上）两处声明 22 个相同事件，改一个要同步两处；且 `NerveEventMap` 全仓库零消费。

**对照 satori/koishi**：它们**只**在 `declare module "cordis" { interface Events }` 声明一份事件签名（参数统一用 Session），没有平行的第二注册表。

**结论**：事件签名只在 `cordis.Events` 声明。具体事件接口 `extends NerveEvent` 承载字段；NerveEvent 的 IM 扩展字段用 `declare module "@athena-ai/protocol"` 追加可选字段。**不要**创建 `XxxEventMap` 之类的东西。

### 14.3 旧 API 的清理面比想象大

**现象**：删除 vendor 后，`ctx.satori.bots`、`ctx.message`、`@satorijs/core` 的引用散落在 cortex-chat / sandbox / sandbox-nerve / 测试 / client vue 文件 / docs 中。

**结论**：

- `ctx.satori.bots` → `ctx.nerve.get(sid)`（`sid = platform:selfId`）
- `ctx.message` → 订阅 `cordis.Events` + 用 `event.body` 发送
- `@satorijs/element` → `@cordisjs/element`（同名 API，纯换 import）
- `bot.createEvent()` → `body.session()`
- 事件类型 `message` → `message-created`
- 删除前先 `grep -rn "@satorijs\|capability-message\|vendor/"` 摸清影响面，含测试和 client

### 14.4 Body 基类应该默认注册自己

**现象**：`SandboxBot` 迁移到 `IMBody` 后测试失败——`ctx.nerve.get(sid)` 返回 undefined，因为 SandboxBot 没有注册进 nerve。

**根因**：注册逻辑（`ctx.nerve.register`）原本只写在 OneBotBody 的 `Service.init` 里，每个新 Body 都要手写一遍，漏写就静默不注册。

**结论**：**Body 基类提供默认 `*[Service.init]()`**（注册 + connect + dispose 断开）。子类需要定制时 `yield* super[Service.init]()`。新 Body 只需 `static inject = ["nerve"]` + 实现 `connect`/`disconnect`。

### 14.5 adapter 请求/响应桥不要用模块级全局状态

**现象**：ws.ts 用模块级 `let counter = 0; const listeners: Record<number, ...>` 关联 echo。多实例（多 QQ 号）时 echo 冲突、超时清理错乱。

**结论**：把 `listeners`（`Map<echo, { resolve, timer }>`）、`counter`、`nextEcho()`、`accept()` 全部放 **Internal 实例**上。超时定时器在 `accept()` 命中时 `clearTimeout`，未命中时超时自清——不泄漏。

### 14.6 `createEvent` 不会自动推导事件字段（已修订：Session 访问器接管）

**现象**：从 Satori Session 迁移到 `createEvent` 后，`isDirect` / `guildId` 变成 undefined。Satori 的 Session 会根据 channel 类型自动推导 `isDirect`、从 guild 推导 `guildId`；Nerve 的 `createEvent` 是纯工厂，**只填 base 字段**（selfId/platform/timestamp/body）。

**结论（2026-08-26 修订）**：这条已被推翻——迁移到 Session 信封后，`session()` 工厂 + `defineAccessor` 访问器按 satori 模式从嵌套数据对象推导：`isDirect` 从 `channel.type === DIRECT`、`guildId` 从 `guild.id`、`channelId` 从 `channel.id`、`content` 从 `message.content`。adapter 只需填嵌套对象，不再手工填派生字段。

### 14.7 协议拆分越薄，删除越容易

**正面教训**：`protocol`（无 IM 语义：Body 基类 + NerveEvent + NerveService）与 `protocol-im`（IM 增强：实体类型 + IMBody + cordis.Events 声明）的拆分，让"删掉整个 vendored Satori"变成**纯增量替换**——没有一处需要反向迁移。保持协议层"只含类型契约 + 极薄基类"是值得坚持的方向。
