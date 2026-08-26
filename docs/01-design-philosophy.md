# 设计理念与三原语

> 本文回答"为什么"。想知道"怎么做"，去 [04-patterns-and-recipes.md](./04-patterns-and-recipes.md)；想知道"长什么样"，去 [02-architecture.md](./02-architecture.md)。

---

## 1. 定位边界

### 1.1 Athena 是什么

- 专为**拟人 AI / 数字生命**设计的框架内核与工具包
- 为 YesImBot、YesImBotWorld、HDS-Interlude 提供可复用、可扩展、可组合的基础设施
- 未来可支撑 IM 之外的场景（Minecraft、Live2D、物理身体）

### 1.2 Athena 不是什么

- **不是**领域无关的通用 Agent 执行层（区别于 agent-runtime）
- **不是**又一个 bot 框架（区别于 Koishi / AstrBot / deepseek-harness）
- **不是** LLM 消息处理管道（区别于 AstrBot 的 pipeline 模式）

### 1.3 一句话差异

| 框架        | 一句话身份                             |
| ----------- | -------------------------------------- |
| **Koishi**  | 用于构建功能丰富聊天机器人的插件平台   |
| **AstrBot** | LLM 驱动的消息处理管道                 |
| **Athena**  | 让数字生命跨多维度持续存在的运行时内核 |

关键词是 **exist（存在）**。Koishi 造的 bot 会 _respond_，AstrBot 造的 AI 会 _chat_，Athena 造的实体会 _live_。

---

## 2. 三原语详解

### 2.1 Life（生命）—— "我是谁"

> 跨时间持续的身份。不是配置，是存在本身。

Life 持有一切让"这个存在"成为"这个存在而非别的存在"的东西：

- **Persona essence** —— 不是 prompt 模板，而是角色的压缩表示
- **Accumulated memory** —— 经验沉积（vector / text / structured / hybrid）
- **Self-model** —— 对当前状态的自我认知（"我今天很累"、"我对这件事有看法"）

Life **不知道**自己如何感知、如何行动。它只是"在"。

**生命周期**：Life 跨进程重启、跨 Cortex 更替、跨 Nerve 增减而持续。它是唯一的常量。

#### 为什么 Life 不能只是一个 config 文件

Memory 基础设施需要跨切面的持久化、索引、检索和生命周期管理，这些横跨所有其他组件。一个普通插件无法拥有"其他插件（包括 Cortex）都依赖的身份"。

具体地说，框架必须提供：

- 跨进程重启的身份持久化
- Memory 累积基础设施
- Self-model 状态
- Memory 在 Cortex 更替后依然存活（身份连续性）

#### 当前实现

`@athena-ai/plugin-life` 提供 `ctx.life`，持有 `persona` 与 `memory`，并通过 `bind(cortex)` 强制 one-Cortex-per-Life 约束。Memory 目前是 in-memory stub（`MemoryStub`），持久化后端未实现。

---

### 2.2 Cortex（大脑皮层）—— "我如何活着"

> 驱动存在的生存策略。决定"何时思考"与"如何思考"。

Cortex 是数字生命运作方式的完整编排，包含五个环节：

| 环节             | 中文 | 决定什么                                                     |
| ---------------- | ---- | ------------------------------------------------------------ |
| **Rhythm**       | 节律 | 什么条件触发一次"意识时刻"？                                 |
| **Integration**  | 整合 | 多个 Nerve 的感知如何合成为统一觉知？                        |
| **Cognition**    | 思考 | 这份统一输入如何被处理（多步推理 / 单次决策 / 结构化生成）？ |
| **Enactment**    | 执行 | 认知结果如何分发回 Nerve 成为行动？                          |
| **Continuation** | 延续 | 这一刻之后，下一刻何时到来？                                 |

Cortex 是**整体可替换单元**，不被分解为独立轴。早期分析曾试图把它拆成六个独立轴（trigger、context assembly、execution shape、result interpretation、state mutation、continuation），但实践中这些轴强烈共变：execution shape ↔ result interpretation、trigger ↔ continuation、context assembly ↔ state mutation。Cortex 是一个**特定组合**，而非独立槽位的拼装。

#### 三种典型形态

**Reactive / Chat**

```
message 到达 → willingness 计算 → 超过阈值 → 短聚合窗口 → 执行 → 直接派发回复
```

**Continuous / World**

```
永续 heartbeat → drain mailbox → 整合为世界感知 → 每拍一次 tool-call → 延迟/调度派发
```

IM 事件被包裹进 World 感知（"你的手机亮了"），而非直接消费。

**Narrative / Interlude**

```
刺激累积 → debounce 缓冲 → 达阈值 → 单次 structured-output → Story-DB 变更 + 消息
```

#### 为什么 Cortex 不能只是一个普通插件

普通插件在固定的框架结构内运作。**Cortex 就是那个结构** —— 它决定整个认知循环。框架必须提供挂载点、生命周期和契约，却不能约束其内部组织方式。

三个截然不同的产品（Chat、World、Interlude）必须共存于同一框架之上，而框架不能偏爱任何一种模式。

#### 不可热切换

Cortex **不能**在运行时动态切换。不同 Cortex 的状态结构互不兼容（session log vs. world files vs. story DB）。更换 Cortex = 显式 stop + start；Life memory 持续，Cortex 内部状态丢失。类比"转行 —— 记忆还在，工作上下文重置"。

**扩展能力不需要换 Cortex**：新增能力（如 Minecraft）通过安装新 Nerve 插件完成，Cortex 的核心循环不变，只是可用工具池和感知来源扩大了。

**Preset**（Cortex 内部行为风格）**是**可动态切换的 —— 但这是 Cortex 内部实现细节，框架不介入。当前延后设计。

#### 当前实现

`Cortex` abstract class 在 `@athena-ai/protocol`，`static inject = ["life"]`，在 `*[Service.init]()` 中调用 `ctx.life.bind(this)` 并 yield 返回的 disposer。`@athena-ai/cortex-chat` 是唯一实现，目前仅有 echo 逻辑，尚无 LLM 集成。

---

### 2.3 Nerve（神经通路）—— "我存在于何处"

> 存在与世界之间的接触面。不是"adapter"，而是存在得以在场的介质。

数字生命不"拥有"身体 —— 它**通过 Nerve 存在**。多个 Nerve 同时运作（非互斥），如同人同时看、听、触。

```
Life 的觉知场
  ├── 通过 IM Nerve：感知"有人在群里 @ 我"
  ├── 通过 World Nerve：感知"下午三点了，该休息"
  └── 通过 Expression Nerve：（无输入；被动维持当前表情）
```

每个 Nerve 提供：

1. **Sense channels** —— 世界状态流入存在
2. **Act channels** —— 存在的意志流向世界
3. **Presence** —— 存在在该介质中"是什么"（avatar、name、status）

#### 为什么叫 Nerve 而不是 Adapter

"Adapter" 暗示的是格式转换 —— 单向、无状态、可互换的胶水。而 Nerve 的关键特征是**双向导管**：sensory nerves 传入，motor nerves 传出，这与 Athena 需要的语义完全对应。同时 Nerve 与 Cortex 在解剖学上关系正确 —— 神经把大脑连向外部世界。

粒度也是对的：**一条 nerve = 一条完整的连接通路**。对 IM 来说，一个 Nerve 对应一个 Body 实例（一个平台上的一个账号，如 OneBotBody / SandboxBot）。两个 QQ 账号 = 两个 Body 实例，各自独立注册进 `ctx.nerve`。

#### Nerve 与 Body 的关系

```
Cortex  ──subscribes──►  cordis.Events（message-created 等）
Body    ──dispatch────►  cordis.Events（发射事件）
Body    ──register────►  ctx.nerve（多实例注册表，按 sid 寻址）
```

**Cortex 永不依赖具体的 Nerve 包。** 事件通过 `cordis.Events` 声明消费，发送通过事件上的 `body` 引用。多个 Body 可以同时注册进 `ctx.nerve`。

例：`ctx.nerve` 中有由不同 adapter（`nerve-onebot`、`sandbox`）注册的多个 Body。Cortex 订阅 `message-created` 事件，需要回复时直接 `event.body.sendMessage(...)`。

#### IM 的 Nerve 实现 = IMBody

`IMBody`（protocol-im）已经履行了全部 Nerve 职责：

| Nerve 职责       | 由谁履行                                                    |
| ---------------- | ----------------------------------------------------------- |
| 平台连接生命周期 | `Body.connect` / `disconnect`（基类 Service.init 自动调用） |
| 统一操作接口     | `IMBody` 方法（`sendMessage` / `getGuild` …，未实现抛错）   |
| 事件发射         | `body.dispatch(event)` → Cordis events                      |
| 多实例管理       | `ctx.nerve` registry（`get(sid)` 寻址）                     |
| 内容模型         | `@cordisjs/element`（protocol-im 提供工厂函数）             |

对非 IM 场景（Minecraft、Live2D、Audio），Nerve = 继承 `Body` 基类、注册进 `ctx.nerve` 的连接实例，遵循相同模式。

---

## 3. 为什么是 Push-based

### 3.1 被推翻的设计：Sense Queue

早期设计（`spirit-pulse-medium-domain-model.md` FR-004/FR-005）要求：

> Capability 事件投递 **MUST** 是 pull-based（可订阅源 + Mode 自有 inbox），而非 push-based 广播。Mode 控制 drain 节奏。

这条被**明确否决**（D-05 / D-28）。

### 3.2 否决理由

1. **Cordis 与 Satori 原生就是 push-based** —— `Bot.dispatch → ctx.emit`。在 push 基础设施上硬造一层 pull 抽象，只是把复杂度搬家。

2. **三种 Cortex 都需要缓冲，但策略完全不同**：
   - Chat：willingness 计算 → 阈值触发 → 短聚合窗口 → 执行
   - World：mailbox 缓冲 → heartbeat drain → 执行
   - Interlude：debounce 缓冲 → 阈值 drain → 执行

3. **缓冲策略深度依赖产品语义** —— 窗口长度、触发条件、聚合逻辑都是产品特有的。框架强加一个 queue 抽象会过度约束 Cortex 设计。

4. **"调度是 Cortex 内部的事"** 这条既有设计原则，同样适用于事件消费。

### 3.3 最终形态

Nerve（经 Capability）发射 Cordis 事件；Cortex 通过 `ctx.on(...)` 订阅，自行管理消费策略。框架**不提供**任何 queue / inbox / mailbox 抽象。

```typescript
// Chat Cortex
ctx.on("message", (session) => {
  this.willingnessEngine.ingest(session);
  // 触发时：短聚合窗口，然后执行
});

// World Cortex
ctx.on("message", (session) => {
  this.mailbox.push(session); // 缓冲
});
// heartbeat 循环中：drain mailbox → integrate → execute

// Interlude Cortex
ctx.on("message", (session) => {
  this.debouncer.push(session); // debounce 缓冲
});
// debounce 窗口结束后：聚合 → 执行
```

### 3.4 代价与补偿

Push-based 的代价是**没有天然的串行化保证** —— 事件可能在上一次处理未完成时到达。这是 Cortex 的责任，框架不代管。补偿手段是：Cortex 内部自行实现串行队列 / 状态锁 / 幂等设计。

多 Life 场景下事件不会串台，因为有 `[Context.filter]` 作用域过滤（见 §4.3）。

---

## 4. 为什么 IM 是"能力"而非"基质"

### 4.1 Koishi 的做法及其后果

Koishi 让 Satori 成为**基础基质**，其 `Context` 类字面上继承 `satori.Context`：

```typescript
// @koishijs/core/src/context.ts
export class Context extends satori.Context { ... }
```

后果：

- 每个 Koishi context **就是**一个 Satori context
- `ctx.satori`、`ctx.bots` 在任何地方、对任何插件都可见
- **框架身份即 messaging** —— 没有 Satori 就无法使用 Koishi
- Bot 生命周期、session 处理、middleware chain 全部假设 IM 是核心流程

### 4.2 Athena 的做法

IM 是**平级的能力**，不是框架基质。Athena 自研 Nerve 协议：`protocol` 定义极薄的 Body/Session 基类（Session 信封 + `defineAccessor`），`protocol-im` 提供 IM 实体、IM 访问器与事件契约，平台 adapter（`nerve-onebot`、`sandbox`）继承 `IMBody` 注册进 `ctx.nerve`。Cortex 通过 `cordis.Events` 消费事件，通过事件上的 `body` 引用发送。

| 方面              | Koishi                           | Athena                                  |
| ----------------- | -------------------------------- | --------------------------------------- |
| Context 继承      | `Context extends satori.Context` | 原生 cordis `Context`；Nerve 是独立协议 |
| IM 协议           | Satori（外部生态）               | 自研 Nerve（protocol + protocol-im）    |
| Bot 访问          | 每个 context 上都有 `ctx.bots`   | `ctx.nerve.get(sid)` 显式寻址           |
| 框架身份          | **是**一个 messaging 框架        | **有** messaging 能力                   |
| 没有 messaging 时 | 无法运行                         | 正常运行（其他能力 + 自主节律）         |
| 移除 messaging    | 不可能                           | 不装 adapter 插件即可，框架继续         |
| 新增非 IM 能力    | 螺在 messaging 之上              | 平级的兄弟 Nerve（Minecraft、Live2D…）  |

### 4.3 事件作用域

事件通过 `body.dispatch()` 发射到 Cordis 事件总线，多 Life 隔离由 group 级 `isolate: { life, cortex, nerve }` 保证。事件字段（`channelId`/`userId`/`guildId`…）由 adapter 显式填充，Nerve 协议层不自动推导。

**Cortex 不需要自我过滤。** 框架保证作用域正确的事件投递。

### 4.4 隔离带来的具体收益

1. **Messaging 是可选的** —— World Cortex 只用 `ctx.minecraft` 就能跑，进程里连 adapter 都没有。这在 Koishi 中架构上不可能。

2. **防止形状泄漏** —— Koishi 里每个插件都能 `ctx.bots[0].sendMessage(...)`，框架在每一层都是"satori 形状"的。Athena 里只有订阅了事件、拿到 `body` 引用的代码才能访问。

3. **多 Nerve 平权** —— `nerve-onebot`、`sandbox`、未来的 `nerve-minecraft` 结构上完全相同，各自是 `IMBody`（或 Body）实现。Koishi 里 messaging 是特权基础设施，非 messaging 能力是二等事后想法。

4. **没有 event→response 管道** —— Koishi 提供的 middleware chain、command routing、session management 全部假设"消息进 → 处理 → 消息出"。Athena 提供零个 IM 专用框架流程，Cortex 完全自决如何响应（或不响应）。

---

## 5. 与 Koishi 的刻意差异

### 5.1 相同的砖，不同的楼

|          | Koishi                  | Athena                               |
| -------- | ----------------------- | ------------------------------------ |
| 组合基质 | Cordis                  | Cordis                               |
| IM 协议  | Satori（外部生态）      | 自研 Nerve（protocol + protocol-im） |
| 插件机制 | Cordis plugin lifecycle | Cordis plugin lifecycle              |
| 事件投递 | Cordis events           | Cordis events                        |

组合基质与事件投递相同；IM 协议层不同（Athena 自研 Nerve，不依赖 Satori 生态）。差异的核心在于**框架对其用户和所服务实体的假设**。

### 5.2 Koishi 的核心假设

> 外部事件 → 框架处理管道 → 响应

Koishi 的整个架构服务于这个假设：

- `Session` = 一次性事件快照（消息到 → 处理 → 回复 → 结束）
- Middleware chain = 线性 input→transform→output 管道
- Command system = request/response 模式
- Bot = 被动实体（等事件；从不自主行动）

### 5.3 Koishi 无法表达的东西

- 没有消息到达时仍然"活着"的实体
- 基于意愿的响应（决定**不**回复是一个合法动作）
- 超越单个 Session 生命周期的跨事件持续状态
- "我通过在世界中行动而存在，不是通过回复消息而存在"
- 多个同时存在的维度（IM + Minecraft + Live2D）

### 5.4 Athena 的四条不可归约原语能力

为避免退化成"Koishi + 一个大插件"，框架**必须**提供 Koishi 插件与 AstrBot Star 都无法独立实现的能力：

| #   | 能力                                | 为什么不能"只是个插件"                                                                                                  |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| 1   | **Life 生命周期与 Memory 基础设施** | Memory 需要跨切面的持久化/索引/检索/生命周期管理；插件无法拥有其他插件都依赖的身份                                      |
| 2   | **Cortex 作为可替换认知单元**       | 插件在固定结构内运作；Cortex **就是**结构                                                                               |
| 3   | **多 Capability 统一事件空间**      | 若核心路径假设 message→response，非 chat 能力永远是二等公民                                                             |
| 4   | **自主节律**                        | 事件驱动框架中"无事件 = 无计算"；timer 插件能伪造自主性，但框架的生命周期管理、资源分配、可观测性都不为无提示计算做打算 |

### 5.5 为什么用 Satori 不等于变成 Koishi

Satori 被当作**库**（IM 协议实现）使用，而非**框架的组织中心**。核心路径对比：

```
Koishi:  Session → middleware chain → command → response
Athena:  Life → Cortex → willingness/buffer/integration → 多模态行动（或不行动）
```

类比：Django 和 Flask 都用 WSGI/ASGI，但它们是组织原则不同的两个框架。Koishi 和 Athena 都用 Satori，但服务于根本不同的目的。

### 5.6 我们刻意共享的东西

共享基础设施是**优势**，不是弱点：

- **Cordis** 作为组合基质 —— 经过验证的、稳定的、强大的插件生命周期
- **Satori** 作为 IM 协议 —— 成熟的 adapter 生态，不重复发明
- **Command / permission 系统**（未来）—— 可能在合适处参考 Koishi 实现
- **LLM tool calling 模式** —— 通用 AI SDK 模式

用同样的砖不等于盖同样的楼。区分框架的是组织原则 —— 框架假设什么、强制什么、使能什么。

---

## 6. 工具模型

> ⚠️ **三层模型已废弃。** 原 Layer 1 / Layer 2 / Layer 3 分层在引入 Focus 机制和 Body 注册表后不再适用。
> 当前设计见 [cookbook/04-tool-design.md](./cookbook/04-tool-design.md)。以下保留历史描述供理解演变。

### 统一 Tool 模型（当前）

LLM 消费的 tool 不分层——所有 tool 都是 AI SDK `tool()` 的返回值，合并成统一 `ToolSet` 传给 `generateText`。两种注册来源：

- **Cortex 内置**：Cortex 直接构造（`send_message`、`wait` 等），闭包捕获 focus 状态作为默认寻址
- **插件贡献**：第三方插件通过 `ctx.tools.register(name, tool)` 注册，Cortex 装配时通过 `ctx.tools.available()` 收集

平台能力通过 Body 方法直接访问（`event.body.sendMessage()`、`ctx.nerve.get(sid)`），不需要额外抽象层。

### 历史：三层分层（已废弃）

早期设计将 tool 分为 Layer 1（Cortex 代码调的平台原语）、Layer 2（Cortex 定义的 LLM tool）、Layer 3（插件贡献的平台特有 LLM tool）。废弃原因：

- Focus 机制恢复了默认操作目标，不需要每个 tool 完整寻址
- Body 注册表已解决平台访问，Layer 1 不需要单独抽象
- 从 LLM 视角所有 tool 同质，Layer 2/3 区分增加无谓认知负担
- 两条注册路径最终合并为一个 ToolSet，说明它们本就是同一种东西

### 无 tool context 注入

Athena 的 tool 不接受框架注入的 context。tool 通过**参数**接收完整寻址信息，由 LLM 决定目标：

```typescript
// tool 接收完整寻址作为 LLM 提供的输入
{
  channelId: string,   // 必需
  content: string,     // 必需
  botSid?: string,     // 单 bot 时可省略；多 bot 时必需
}
```

**为什么在 Athena 可行而在 YesImBot v3/v4 不可行**：

- v3/v4 的 agent 是 channel-scoped → 注入 channelId 防止跨 channel 操作（安全考虑）
- Athena 的 Life 是全局的 → 它**需要**跨 channel 操作（"根据 QQ 事件在 Discord 回复"）
- LLM 已经知道完整上下文（来自所有 channel 的事件）→ 它能正确选择目标
- Cortex 控制 prompt 来引导正确寻址

Tool 通过注册时所在的 Cordis context 访问 service，而非通过注入参数或闭包捕获实例。`abortSignal` 由 AI SDK v7 原生提供，无需框架注入。

---

## 7. Cortex 扩展机制（Hook Protocol）

**原则：约定优于强制。**

三个扩展层：

| 层               | 机制                            | 能力                                   |
| ---------------- | ------------------------------- | -------------------------------------- |
| Tool 注册        | 插件向 `ctx.tools` 注册 tool    | 新增 LLM 可访问能力（Cortex 无关）     |
| Lifecycle hooks  | Cortex 在关键点发射 Cordis 事件 | 变换流经 Cortex 管道的数据             |
| ~~Cortex mixin~~ | ~~向 Cortex 内部注入逻辑~~      | ~~**不支持** —— 对内部一致性风险过高~~ |

Hook protocol 是**推荐而非强制**：框架定义推荐的 hook 名与签名；Cortex 作者自行选择发射哪些（全部、部分或不发）；社区插件监听 hook，若当前 Cortex 不发射则插件静默无效。

推荐的 hook 与 Cordis dispatch 模式：

| Hook 点                   | Dispatch 模式 | 语义                                    |
| ------------------------- | ------------- | --------------------------------------- |
| `cortex/before-drain`     | `waterfall`   | 整合前变换/过滤感知事件                 |
| `cortex/after-integrate`  | `waterfall`   | 向装配好的上下文注入内容（RAG、memory） |
| `cortex/before-cognition` | `waterfall`   | LLM 调用前修改 prompt / tools / 参数    |
| `cortex/before-enact`     | `bail`        | 拦截/否决行动（内容审核、限流）         |
| `cortex/after-enact`      | `parallel`    | 行动后副作用（日志、统计、触发器）      |

`waterfall` 在 cordis v4 中是 **`next()` 中间件链**（koa 风格），不是 reduce：listener 签名为 `(...args, next)`，必须调用 `next()` 才会继续下游；`ctx.waterfall(name, ...args, inner)` 的最后一个参数是链尾的 `inner` 回调。这让社区插件能在指定点变换数据或短路，而无需理解或修改 Cortex 的内部循环 —— Cortex 的结构完整性得以保全。

**状态**：hook 契约尚未在 `@athena-ai/protocol` 中声明，是 Phase 2 的工作项。

---

## 8. 成功判据

### 8.1 退化测试（任一为真 = 已退化）

1. ❌ Life 只是 Cortex 启动时读一次的 config 文件
2. ❌ Cortex 只是个订阅事件的普通插件（无可替换单元契约、无 one-per-Life 强制）
3. ❌ 非 IM capability 是二等公民
4. ❌ 框架把 event→response 当核心流程
5. ❌ Memory / persona 是静态的

### 8.2 成功判据（作为独立框架成立）

1. ✅ World Cortex（持续 heartbeat，无需外部触发）与 Chat Cortex 一样自然工作
2. ✅ 更换 Cortex 包能改变整个认知策略，同时保留身份
3. ✅ Minecraft 事件与 IM 消息通过完全相同的机制被消费
4. ✅ 一个实体可以数小时不收到任何消息，仍然"活着"（演化、记忆、偶尔行动）
5. ✅ Life memory 在交互中可验证地演化，无需人工干预

### 8.3 与 AstrBot 的对照

| 维度         | AstrBot                              | Athena                                                       |
| ------------ | ------------------------------------ | ------------------------------------------------------------ |
| **存在模型** | 被动响应者（消息触发 pipeline）      | 持续存在者（有自己的时间线和节律）                           |
| **认知单元** | 一次 pipeline 执行 = 一个对话轮      | 一次 Cortex cycle = 一个意识时刻（可跨多消息，可无消息触发） |
| **身份**     | Persona config（静态 prompt）        | Life（持续演化的 memory + self-model）                       |
| **行动空间** | 回复消息（+ tool call 作为中间步骤） | 多模态行动（IM、world、表情、语音 —— Cortex 整合并派发）     |
| **时间感**   | 无（事件驱动，无事件无计算）         | 有（Cortex 有 heartbeat / 节律，可无输入行动）               |
| **演化**     | 无（知识库人工更新）                 | Life memory 持续累积，self-model 自动演化                    |
| **认知策略** | 固定 pipeline（9 阶段，顺序不可变）  | 可替换 Cortex（完全不同的认知包：chat / world / interlude）  |

---

## 9. 未决问题

以下问题在设计上留待未来解决，实现时不要擅自锁定：

- Life memory 基础设施的确切形态（vector DB？structured storage？hybrid？）
- Self-model 的表示与演化机制
- Cortex 契约接口规范（Cortex 必须向框架提供什么？）
- 框架级可观测性（Execution Record）如何捕获自主认知周期
- "退化测试"是否应形式化为验收测试
- Bot 归属强制：框架是否应阻止 Life A 使用 Life B 的 bot，还是 prompt 级引导足够？
- Tool 描述动态化：`ctx.tools` 是否应支持动态描述（如根据当前状态列出可用 bot/channel）？
- Tool 命名约定：插件 tool 是否命名空间化（`onebot.set_essence`）还是扁平？
- Layer 3 tool 注册机制（D-08 延后）
- 多 Life 共享 Bot 实例（v2 延后）
- Adapter config 热重载策略
