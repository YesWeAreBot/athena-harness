# Athena 上下文构造研究报告（结论先行）

> 证据标签：`[代码事实]` = 当前源码直接可见；`[当前 docs]` = 正式文档对当前架构/roadmap 的陈述；`[设计/Spec]` = `.specify/specs` 中的拟议设计，不能当作已实现；`[代码推断]` = 由已证实调用边界推导；`[无法验证]` = 目标路径没有足够实现证据。权威顺序是当前代码 > 最新用户指令 > `docs/` > `.specify/specs/`（`docs/00-overview.md:149-152`；`docs/appendix/C-decision-index.md:3-5`）。

## 一句话总结

当前 Athena 只有 Life 的 persona/memory 容器、Capability/Nerve 的消息/沙盒传输和 CortexChat 的 `Session → echo` 骨架；真正的 per-request context construction、append-only transcript、frame snapshot、prompt-cache 前缀、tool-loop、world/rhythm 和 research-context 都尚未落地，因此应把上下文构造认定为 Cortex 所有、输入归一化归 Capability/Nerve、身份与长期记忆归 Life、模型解析归全局 AIService，而不能把 `.specify` 中的 D-37~D-41 当成当前能力。

## 1. 当前代码到底存在什么

### 1.1 `protocol` 是契约层，不是上下文运行时

- `[代码事实]` `packages/protocol/src/types.ts:5-15` 只有 `Persona`/`PersonaTraits`；`18-35` 定义 `SearchOptions`、JSON 可持久化的 `MemoryValue`、`MemoryEntry` 和三方法 `MemoryProvider`；`38-43` 的 `LifeService` 只有 `persona`、`memory`、`cortex`、`bind`，没有 `id`、`dataDir`、Perception、Session、transcript 或 context-builder。
- `[代码事实]` `packages/protocol/src/index.ts:1-15` 只导出 Cortex、Life/Memory、Sandbox contracts；没有 `Events.perception`、`PerceptionMap`、`EntryMap` 或 `ModelMessage` 契约。
- `[代码事实]` `packages/protocol/src/cortex.ts:3-13` 的 `Cortex` 只声明 `inject = ["life"]`，在 `[Service.init]` 中 `life.bind(this)` 并 yield disposer；它不接收事件、不建队列、不构造 prompt。
- `[当前 docs]` 包边界也把 protocol 定义成“类型 + Cortex abstract class”，而把 cognition 的五个环节（rhythm/integration/cognition/enactment/continuation）归为 Cortex（`docs/01-design-philosophy.md:66-120`；`docs/02-architecture.md:92-152`）。

### 1.2 `@athena-ai/ai` 只解析模型，不拥有上下文

- `[代码事实]` `packages/ai/src/service.ts:109-118` 明确写出 provider registry/model resolver 是 global，模型是 stateless shared resources，`ai` 不进入 per-Life isolate；`117-151` 构造 models config、declarations、groups 和 model wrapper cache。
- `[代码事实]` `service.ts:192-224` 的 `language/embedding/image/speech/transcription/reranking` 只做 modality model resolution；`231-240` 的 `candidates()` 只把单模型/group/alias 展开成 `Candidate[]`；`242-286` 提供 group/list/metadata 查询。
- `[代码事实]` `packages/ai/src/group.ts:16-19,40-63` 明确 group 只排序、过滤 circuit breaker、收集 `success/failure`，**不**包装或运行 `generateText`/`streamText`；重试/failover 的循环由 Cortex 写。
- `[代码事实]` `packages/ai/src/types.ts:21-31` 支持六种 modality（含 embedding/reranking），`152-170` 的 Candidate/ModelGroup 暴露原生 AI SDK model；这能支撑 research retrieval 或 world cognition 的模型选择，但没有 history、retriever、web fetch、prompt assembly。
- `[当前 docs]` `docs/04-patterns-and-recipes.md:1076-1103,1155-1170` 也明确 `ctx.ai` 已可用，而 `cortex-chat` 尚未集成 AI SDK；provider 内建 web search 不经 `ctx.ai`（`docs/04-patterns-and-recipes.md:1167-1168`）。

### 1.3 Life 只有最小 identity/memory stub

- `[代码事实]` `plugins/life/src/life.ts:8-23` 的 `MemoryStub` 使用进程内 `Map`，`store/retrieve` 可用但 `search()` 永远返回空；`24-35` 构造时只解析 persona 并安装该 stub；`55-59` 对 string persona 直接抛“file loading not yet implemented”。
- `[代码事实]` `life.ts:24-53` 的 `bind()` 强制一个 Life 只绑定一个 Cortex，并返回安全 disposer。
- `[当前 docs]` `docs/01-design-philosophy.md:35-63` 将 persona/memory/self-model 定义为 Life 的持续身份，但同时明确当前仅有 in-memory stub；`docs/06-progress-and-roadmap.md:21-30,55-68,258-290` 将 persistence、persona file、self-model 列为未完成。

### 1.4 `capability-message` 拥有 Satori transport/input boundary，但没有统一 Perception 或 transcript

- `[代码事实]` `plugins/capability-message/src/index.ts:45-51` 在自身 Context 安装 Satori；`76-106` 只提供 `bots`、`createMessage`、`sendMessage`、`sendPrivateMessage` 与 `_resolveBot` 出站 API。
- `[代码事实]` `index.ts:35-74` 监听全局 `internal/session`，先 unwrap traced proxy，再以真实 Bot 的 `satori` isolate 判定归属，最后给原始 Session 挂 `Context.filter`，按 `message` isolate 限定投递。当前过滤的是 Satori Session，不是 spec 设想的 `perception` 事件，也不是 life-symbol filter。
- `[代码事实]` 当前 Cortex 可收到入站事件的前提，是 Satori Bot dispatch 生成的裸 Session；MessageService 没有 `Perception` translator、`message/received` kind、事件声明、archive 或 Session store。
- `[当前 docs]` 这正是现状核验：`ctx.message` 只有出站 API，入站只在 `internal/session` 上打 filter，Cortex 直接收裸 Session（`.specify/specs/perception-protocol-and-session-design.md:43-55`；`docs/06-progress-and-roadmap.md:23-30,55-68`）。

### 1.5 `cortex-chat` 只有 message→echo

- `[代码事实]` `plugins/cortex-chat/src/index.ts:15-20` 是唯一当前 Cortex 实现，`inject = ["life","message"]`；`22-28` 订阅 `message` 并把 `Session` 传入 `onMessage`。
- `[代码事实]` `index.ts:31-44` 跳过 self message，读取 `ctx.life.persona` 与 `session.content`，然后直接调用 `ctx.message.createMessage` 发送 `[persona.name] Echo: content`；没有历史读取、Memory search、willingness、buffer、per-channel lock、AI SDK call、tool result、retry/failover、frame 或 cache。
- `[当前 docs]` `docs/06-progress-and-roadmap.md:23-30,61-68,231-254` 将它标为 echo skeleton，并把真实 Phase 2-C cognition 列为未来；`docs/research/native-digital-life-framework/04-cybergroupmate.md:218-222`、`05-maibot.md:77-80` 也明确当前 CortexChat 尚未形成真实认知闭环。

### 1.6 Nerve 目前是 transport bridge，且 Sandbox 非 IM 仍伪装成 Satori

- `[代码事实]` `plugins/sandbox-nerve/src/index.ts:19-47` 是 per-Life Nerve，注册到 global Sandbox Hub，life id 实际为 `ctx.life.persona.name.toLowerCase()`；它保存每个 browser platform 的 Bot handle，并在 dispose 时清理。
- `[代码事实]` `index.ts:54-87` `_dispatch()` 懒建 `SandboxBot`，回显用户消息，拼 `Universal.Event`，再 `bot.dispatch(session)`；`91-107` `_request()` 代理浏览器 read API；`111-145` `_ensureBot()` 在本 Life 的 Satori domain 中创建 Bot。
- `[推断]` 因此 Nerve 的实际职责是连接生命周期、平台寻址、transport 和事件注入，而不是拼 LLM prompt；但当前 Sandbox 还不能证明“原生非 IM Perception”。
- `[当前 docs]` 现状核验直接承认非 IM 今天必须造 `SandboxBot`/`Universal.Event`/`bot.dispatch(session)`（`.specify/specs/perception-protocol-and-session-design.md:47-54`）；Phase 4 仍把 `cortex-world`、`capability-minecraft` 列为未来（`docs/06-progress-and-roadmap.md:294-315`）。

### 1.7 persistence/archive 还不存在

- `[代码事实]` `plugins/message-store/src/index.ts:1-5` 明确是 Phase 3 placeholder，只有 `export {}`，没有 archive、DB、query 或 subscription。
- `[当前 docs]` `docs/06-progress-and-roadmap.md:30,55-68` 仍将 message-store 标为占位；因此 spec 中“Perception archive 由 message-store 订阅并供 Memory/RAG/审计查询”是未来 ownership，不是当前事实。

## 2. Context construction 的 likely ownership seam（仅定位，不作实现方案）

| 层                                  | 当前已拥有的东西                                                                                                                                                         | 对 context construction 的边界判断                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Life**                            | persona、MemoryProvider、one-Cortex binding（`plugins/life/src/life.ts:24-59`）                                                                                          | 提供 identity、长期 memory/self-model 的稳定输入；不应拥有某个 Cortex 的 scene grouping、prompt format 或 tool-loop。`docs/01-design-philosophy.md:35-63` 把 Life 定义为“我是谁”。                                                                                                                 |
| **Cortex**                          | 目前只有绑定和 echo；架构定义它拥有 rhythm/integration/cognition/enactment/continuation（`packages/protocol/src/cortex.ts:3-13`；`docs/01-design-philosophy.md:66-120`） | **最可能的 context owner**：按请求/帧决定何时构造、选哪些 scene、读取哪些 Life memory、组织 user/system/assistant/tool、处理变动尾块、缓存/裁剪、调用 AI、解释结果并 enact。`docs/06-progress-and-roadmap.md:231-245` 的 persona + recent messages + memory retrieval + tool-loop 正好落在此边界。 |
| **Capability / capability-message** | Satori 安装、Bot registry、入站 Session filter、出站 send APIs（`plugins/capability-message/src/index.ts:35-106`）                                                       | 输入归一化和 IM transport boundary；若 D-37 实施，`Session → Perception` translator 最自然地在 capability 内。它不应决定跨 scene transcript、Cortex rhythm 或 LLM prompt。                                                                                                                         |
| **Nerve**                           | 连接实例、presence、平台寻址、Bot/Hub lifecycle、dispatch/request/release（`packages/protocol/src/sandbox.ts:15-91`；`plugins/sandbox-nerve/src/index.ts:19-145`）       | 负责 world/transport observation、action target、receipt/reliability 与 lifecycle；不应持有 Life 的统一上下文。当前 Sandbox 的 fake Session 是 transport workaround，不是 context owner。                                                                                                          |
| **`@athena-ai/protocol`**           | 纯 types、Cortex base、Cordis augmentation（`packages/protocol/src/index.ts:1-15`）                                                                                      | 适合承载 Perception/Scene/Actor/Events 等纯契约；不适合做运行时 history/store/render。spec §9 也把它限定为“纯类型 + 一条事件”（`.specify/specs/perception-protocol-and-session-design.md:502-529`）。                                                                                              |
| **`@athena-ai/ai`**                 | global model/provider registry、candidate/group/circuit breaker、embedding/reranking resolution（`packages/ai/src/service.ts:109-151,192-286`）                          | 只提供模型/候选与 metadata；不拥有 context，不能把 `ctx.ai` 的 model cache 混同 prompt cache。`ModelGroup` 明确把 attempt loop 留给 Cortex（`packages/ai/src/group.ts:16-19`）。                                                                                                                   |
| **Session library / message-store** | 当前均不存在/占位（`plugins/message-store/src/index.ts:1-5`）                                                                                                            | spec 设计上 Session 是 Cortex 侧普通库，archive 是 message-store；这是一条 ownership seam，而非已有实现（`.specify/specs/perception-protocol-and-session-design.md:430-457,530-542`）。                                                                                                            |

## 3. 七个场景的证据矩阵

下表逐场景回答：context segments、变动性与生命周期、cache breakpoint、token scale assumptions、failure modes。`当前` 与 `设计` 分列，避免把探索/Spec 误报成实现。

### 3.1 场景 1：日常对话（群聊 / 私聊）

- **Context segments**：当前只有 `persona.name` + 本条 `session.content`，再经 `createMessage` 输出（`plugins/cortex-chat/src/index.ts:31-44`）。设计目标是 `persona + recent messages + memory retrieval + optional tools`，来源是 `docs/06-progress-and-roadmap.md:231-245`；CyberGroupmate 的 per-chat `GroupSubagent`/history/profile 组合可作为外部证据（`docs/research/native-digital-life-framework/04-cybergroupmate.md:59-81,89-99`），但不是 Athena 已实现行为。
- **Variability / lifecycle**：入站 message、channel/bot sid 和 self-message 状态每次变化；Life persona 在当前 fiber 内稳定，MemoryStub 仅进程内；没有 session/transcript 跨重启。未来 spec 设想 IM scene 无因果时“一 scene 一 session”（`.specify/specs/perception-protocol-and-session-design.md:452-457`），目前不存在。
- **Cache breakpoint / token assumptions**：当前无 prompt cache、无 ModelMessage、无 usage/cache metrics。设计上易变视野应在尾部，最后一条冻结 `frame` 是 breakpoint（spec: `.specify/specs/perception-protocol-and-session-design.md:321-341`）；1024–4096 tokens 是模型缓存的最短量级假设，不是 Athena 测量结果。
- **Failure modes**：当前 send 失败只 logger warn（`cortex-chat/index.ts:39-43`）；多 Bot 未指定 sid 会由 `_resolveBot` 抛错（`capability-message/index.ts:76-106`）；没有 willingness、聚合、串行锁、LLM retry 或 memory failure path（`docs/06-progress-and-roadmap.md:231-254`）。

### 3.2 场景 2：长时编程任务（user messages 与 tool calls 必须区分）

- **Context segments**：目标任务/规则/persona、用户指令、代码/技能文档、assistant tool-call、tool result、阶段状态和长期目标。Mineflayer 探索明确把 Coding 与 Conversation 分开，`!newAction` 生成 JS，经过 ESLint + SES sandbox + execution output/error（`docs/explorations/llm-mineflayer-integration.md:204-267,342-357`）；其上下文还包含 `$CODE_DOCS`、`$EXAMPLES`、`$MEMORY`（`llm-mineflayer-integration.md:68-123`）。
- **Variability / lifecycle**：用户新消息可中断长任务；tool output/error、代码执行日志和目标进度每 step 变化；应把 user、assistant、tool、system 作为不同语义记录。Spec 的 `EntryMap` 原样保留 `AssistantModelMessage`/`ToolModelMessage`/`UserModelMessage`/`SystemModelMessage`（`.specify/specs/perception-protocol-and-session-design.md:350-389`），但当前仓库没有这些 entry/session 类型或调用链。
- **Cache breakpoint / token assumptions**：`[设计推断]` 稳定 system/task/code-doc prefix 可作为缓存前缀，动态 tool history 不能被误并入稳定 frame；Spec 只明确 breakpoint 放最后一条 frozen frame，未给长编程 tool-tail 的独立数值。Mineflayer 的参考预算是 static context 约 4,000 tokens、dynamic history 约 2,000–4,000、总计约 6,000–8,000（`llm-mineflayer-integration.md:95-112`）。
- **Failure modes**：外部参考已列代码错误、命令失败、超时、中断、最多 5 次修复循环（`llm-mineflayer-integration.md:342-357,358-421,523-611`）。Athena 当前没有 `ctx.tools`（`docs/06-progress-and-roadmap.md:55-68,177-208`），没有 tool-loop、sandbox、execution record，因此不能声称支持此场景。

### 3.3 场景 3：游戏 / 具身（frame snapshot + partial tool history）

- **Context segments**：最新位置/health/hunger/time/weather/nearby entities/inventory/equipment/game mode/biome；按需 query；behavior log；可选视觉摘要；长期 memory/goal。Mineflayer 对这些段的来源和表示逐项列出（`docs/explorations/llm-mineflayer-integration.md:127-188`），并把主动查询与行为日志分开（`144-169`）。
- **Variability / lifecycle**：world state 在模型思考期间继续变化（`llm-mineflayer-integration.md:613-644`），所以当前状态/待办/剩余预算是每帧易变尾块；历史事实和 tool result 应保持 append-only。Spec 的 frame 是“实际发送 scene blocks 的冻结快照”，后帧直接复用，不重渲染（`.specify/specs/perception-protocol-and-session-design.md:321-334`）；world agent 可不实例化 session，bot agent 才使用部分 session（spec: `475-510`）。
- **Cache breakpoint / token assumptions**：设计 breakpoint 是最后一条冻结 `frame`，视野摘要放在其后且不冻结；绝对时间戳、易变状态不进 stable prefix、compaction 批量做（`.specify/specs/perception-protocol-and-session-design.md:307-341`）。Mineflayer 参考总输入约 6–8k tokens；Spec 的 1024–4096 cache floor 是依模型的设计假设，不是实测。
- **Failure modes**：状态幻觉/过期 HP、动作超时、错误重试、LLM 等待时世界继续运行、Mode 与 LLM 动作冲突（`llm-mineflayer-integration.md:480-523,613-644,710-718`）。Athena 当前没有 Minecraft capability/world Cortex；SandboxNerve 仍把浏览器输入伪装成 Satori Session（`plugins/sandbox-nerve/src/index.ts:54-145`），故只能证明 transport bridge，不证明具身 context。

### 3.4 场景 4：自发行为 / rhythm tick

- **Context segments**：synthetic self-prompt/heartbeat trigger、当前 world snapshot、active goal、pending action/tool result、Life memory/self-model；它不一定有用户 message。Mineflayer Self-Prompter 用 system-like pseudo message 反复驱动目标循环，状态机为 `STOPPED ↔ ACTIVE ↔ PAUSED`（`docs/explorations/llm-mineflayer-integration.md:49-64,422-451`）；反射性 Modes 与 LLM 并行（`268-357`）。
- **Variability / lifecycle**：每个 tick 的时间、状态、目标进度和高优先级中断易变；Life 应跨 tick 持续，Cortex rhythm/continuation 决定是否再入。正式架构把 heartbeat、mailbox、无外部事件计算列为 World Cortex 责任（`docs/01-design-philosophy.md:66-120,177-228`），但当前没有 `cortex-world`（`docs/06-progress-and-roadmap.md:294-315`）。
- **Cache breakpoint / token assumptions**：同场景 frame 规则可复用，但 tick 视野必须在尾部；长时运行需要 compaction，否则动态状态线性膨胀（spec: `.specify/specs/perception-protocol-and-session-design.md:307-341,459-472`）。没有当前 Athena 运行数据证明 cache hit 或 tick token 成本。
- **Failure modes**：self-prompt 死循环、无命令重复、超时、tick 与 cognition 并发、状态过期；Mineflayer 用“连续 3 次无命令停止 + cooldown/timeout”缓解（`llm-mineflayer-integration.md:422-451,480-489`）。Athena 目前 `CortexChat` 仅被 message event 唤醒，不能宣称自主 tick。

### 3.5 场景 5：多频道 / 多 Nerve 并发存在

- **Context segments**：每个 channel/scene 的 inbound facts、source/bot sid/target、该场景短期 history；共享的 Life persona/memory；跨 Nerve 时是否合并由 Cortex 决定。当前 `MessageService` 维护 domain-local bots，并通过 `Context.filter` 防跨 Satori domain（`plugins/capability-message/src/index.ts:53-74`）；Sandbox Hub/Nerve 按 `lifeId/platform` 路由（`packages/protocol/src/sandbox.ts:24-71`；`plugins/sandbox-nerve/src/index.ts:19-47`）。
- **Variability / lifecycle**：消息来自全局 `internal/session` bus，实际 filter 决定同一 Life group 的 hook；每个 platform Bot 有连接/释放生命周期；Life 只有一个 Cortex（`plugins/life/src/life.ts:42-53`；`packages/protocol/src/cortex.ts:10-13`）。当前 `CortexChat` 没有 per-channel queue/lock，异步 `onMessage` 可能并行（`cortex-chat/index.ts:25-28,31-44`；Cordis emit 不 await 的架构证据见 `docs/research/native-digital-life-framework/01-cordis.md:203-208`）。
- **Cache breakpoint / token assumptions**：Spec 设想无因果的多个 IM scene 各自 session；有因果的 message+Minecraft 共用 session（`.specify/specs/perception-protocol-and-session-design.md:452-457`）。run-length 比纯分组更保留跨维度因果；设计估算纯分组在 K 场景下每帧可能丢失约 `(K−1)/2K` cache，K=2 约 25%，多条到达约 35–50%，但这是 spec 估算而非运行指标（spec: `241-261`）。
- **Failure modes**：无 filter 会造成跨 Life 泄漏；当前 Session 路径已有 satori/message isolate filter，但未来 Perception filter 尚不存在；`lifeId` 取 persona name 可变/重名/含空格（`sandbox-nerve/index.ts:24-37`；spec 明确 D-38 尚未实现）；多个 active Bot 未指定 sid 会发送失败。并发串行化、幂等、receipt 尚未实现（`docs/06-progress-and-roadmap.md:231-254`）。

### 3.6 场景 6：记忆整合 / 反思 / 离线批处理

- **Context segments**：当前请求的 recent events、Life memory/profile、previous outputs/tool results；后台 batch 的 raw facts、interaction/outcome、provenance、visibility；compact/summary 结果；archive 与 hot transcript 应分开。Spec 的边界是 transcript 保存 perception + assistant/tool/frame/compact，而 archive 保存长期世界事实，读者分别是 Cortex 与 Memory/RAG/audit（`.specify/specs/perception-protocol-and-session-design.md:530-542`）。
- **Variability / lifecycle**：Life memory 理应跨 Cortex/restart；即时 transcript 随认知域、可 compact/丢；offline reflection 是慢路径，不能与当前 turn 共享易变 prompt prefix。当前 Life memory 只是 Map，`search()` 空，进程重启即丢；`LifeService` 没有 id/dataDir（`packages/protocol/src/types.ts:23-43`; `plugins/life/src/life.ts:8-35`）。
- **Cache breakpoint / token assumptions**：稳定的 persona/已确认 facts/compact 可进入历史前缀；新检索结果、当前状态和 pending batch 应视作变动尾部。Spec 只规定 compaction 批量触发，未给阈值；Mineflayer 的长期 memory 摘要约 ≤500 chars 是外部探索假设，不是 Athena contract（`llm-mineflayer-integration.md:68-123,460-489`）。
- **外部成熟证据**：CyberGroupmate 具备 SQLite/WAL、session snapshot、bounded RecordingPipeline 和 Reflection checkpoint，失败时不推进水位（`docs/research/native-digital-life-framework/04-cybergroupmate.md:59-81,147-160`）；MaiBot 有 SQLite 恢复、scope-aware retrieval、bounded async memory queues，队列满可丢任务（`05-maibot.md:50-75,99-105`）。这些是可借鉴的证据，不是 Athena 当前实现。
- **Failure modes**：当前无 durable boundary、无 batch worker、无 provenance/visibility enforcement；未来若照 spec 还需处理 snapshot 与 archive 不一致、reflection failure、stale memory、bounded queue drop。`message-store` 为空（`plugins/message-store/src/index.ts:1-5`），所以不能宣称离线 archive。

### 3.7 场景 7：长时研究（大量网页文档，单素材可能超预算）

- **证据边界**：目标列出的 Athena 文件没有 web-browser/research Cortex 或 document store 实现；因此下面部分是 `[代码推断]/[无法验证]`，不能说“当前支持长时研究”。
- **Likely context segments**：stable research instructions/persona；user question/plan；retrieved document chunks；source URL/title/timestamp/provenance；tool fetch/search results；assistant synthesis and citations；durable extracted findings。这个分解与 Mineflayer 的 `$CODE_DOCS`/`$EXAMPLES` embedding retrieval、fixed window、rolling summary 的形状相似（`docs/explorations/llm-mineflayer-integration.md:68-123`），但不等于 Athena 已有 web retrieval。
- **Available model seam**：AI type layer 支持 embedding/reranking（`packages/ai/src/types.ts:21-31`），AIService 也能解析 embedding/reranking models（`packages/ai/src/service.ts:192-224`）；没有 evidence 表明存在 chunker、web fetcher、citation store、research memory 或 retrieval orchestration。`docs/04-patterns-and-recipes.md:1167-1168` 还明确 provider built-in web search 不经过 `ctx.ai`。
- **Variability / lifecycle**：source ordering、retrieval top-k、document chunk boundaries、query refinements、tool outputs 和 source freshness 都会变化；超预算素材必须在 Cortex/research capability 侧裁剪、摘要或分层存储，而不是让 AIService 隐式吞掉。长期 findings 才可能进入 Life memory；raw documents/URLs 更像 Nerve/capability archive 或外部 store。
- **Cache breakpoint / token assumptions**：`[推断]` stable instructions + 已冻结的证据块可成为 cache prefix；当前 query、retrieval results、partial synthesis 应放 volatile tail。Spec 的绝对时间戳、frame freeze、易变内容置尾规则可迁移，但它只讨论 Perception/LLM frame，不给网页研究的 chunk/summary budget（`.specify/specs/perception-protocol-and-session-design.md:321-341`）。不能把 Mineflayer 6–8k 预算当作网页研究上限。
- **Failure modes**：单文档超过预算、retrieval miss/重复、source freshness drift、citation/provenance 丢失、摘要幻觉、跨轮研究目标遗忘、缓存前缀因动态文档内容失效。当前仓库没有可验证的 web fetch/research persistence/long-context behavior；这些均应标 `[无法验证]`。

## 4. `.specify/specs/perception-protocol-and-session-design.md` 与当前代码/架构的冲突表

| Spec claim / section                                                                                     | Current evidence                                                                                                                                                                  | 判定                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| §3.1–3.3：`PerceptionMap`、`Perception`、`Scene`、`Events.perception` 是协议契约                         | `packages/protocol/src/index.ts:1-15` 无 perception exports；`grep` 在 `packages;plugins` 无 Perception/perception 命中；现有 `LifeService` 也无对应字段                          | **未来设计，未实现**。Spec 自己标题写“草案，实现以代码为准”（`.specify:79-80`）。                                                                    |
| §3.4：Perception 为 Cortex 默认入口；Session 仅 IM escape hatch；capability-message 重导出 Satori types  | `plugins/cortex-chat/src/index.ts:4,25-40` 仍直接 import/消费 `@satorijs/core` `Session`；`capability-message/src/index.ts` 无 Satori type re-export                              | **直接矛盾**：当前入口仍是 raw `message` Session；spec §13 Phase A 把迁移列为未完成验收。                                                            |
| §3.3：Perception 发射必须按 `life` isolate symbol 加 filter                                              | 当前 `capability-message` 只在 `internal/session` 上先检查真实 Bot 的 `satori` symbol，再以 `message` isolate symbol 过滤（`capability-message/index.ts:53-74`）                  | **未实现/机制不同**：现有 Session 隔离正确，但不是 spec 的 Perception/life filter。                                                                  |
| §2/§13 Phase B：非 IM capability 可不创建 Bot/Session，直接进入 Cortex                                   | `sandbox-nerve/index.ts:54-145` 明确创建 `SandboxBot`、拼 `Universal.Event`、`bot.dispatch(session)`；无 MC/Live2D/audio capability                                               | **直接矛盾于“当前已具备”的读法**；作为 Phase B acceptance 仍是未完成。                                                                               |
| D-38/§9：Life 增加 stable `id` 与 `dataDir`，替代 persona-name identity                                  | `LifeService` 只有 persona/memory/cortex/bind（`packages/protocol/src/types.ts:38-43`）；SandboxNerve 仍 `_lifeId = persona.name.toLowerCase()`（`sandbox-nerve/index.ts:24-37`） | **直接矛盾/未实现**。                                                                                                                                |
| D-39/§6：`@athena-ai/session` 普通库、`Store`/`Session`/`jsonlStore`/`memoryStore`                       | glob 无 `packages/session`；`plugins/message-store/src/index.ts:1-5` 只有 placeholder                                                                                             | **未实现**。Spec 的“无持久化零成本”是设计语义，不是当前行为。                                                                                        |
| D-40/§5：run-length blocks、`renderBlocks`、frame snapshot、compact、view-tail                           | `packages;plugins` 无 `runLengthBlocks/renderBlocks/frame/compact/ModelMessage` 实现；CortexChat 只做 echo                                                                        | **未实现**。                                                                                                                                         |
| M-32/§5.5：cache breakpoint、absolute timestamps、1024–4096 token floor、cache usage                     | `AIService._cache` 是 `type + fullId` 的 wrapped-model cache（`packages/ai/src/service.ts:126-129,301-318`），不是 prompt cache；无 frame/usage/cache metrics                     | **概念不可混同**：Spec 是未实现 prompt-cache设计；当前只有 model resolver cache。                                                                    |
| §6.1/§6.2：perception append 后由 frame 覆盖，assistant/tool/user/system 原样重放                        | 当前无 append-only store、EntryMap、frame；CortexChat 没有 history                                                                                                                | **未实现**。AI SDK shapes 的“原样使用”是拟议边界。                                                                                                   |
| §6.5/§8：chat 每 scene 一个 session；world message+Minecraft 同 session；world/interlude placement table | `cortex-world`/`cortex-interlude`/`capability-minecraft` 均不存在（`docs/06-progress-and-roadmap.md:55-68,294-315`）                                                              | **架构意图，不是现状**。                                                                                                                             |
| §9：`message-store` 订阅 Perception，archive 供 Memory/RAG/audit                                         | message-store 只有 `export {}`；Life MemoryStub.search 永远空                                                                                                                     | **未实现**。                                                                                                                                         |
| §11.1：Cortex 只经 `ctx.message` 访问 IM、只 import protocol types                                       | 当前 CortexChat 直接 import `Session` from `@satorijs/core`，并直接订阅 raw message；package.json 也未声明该 vendor dependency（`plugins/cortex-chat/package.json:1-40`）         | **当前偏差已由 docs 记录**（`docs/02-architecture.md:142-152`；`docs/06-progress-and-roadmap.md:102-110`），不能把 spec hard constraint 当成已满足。 |
| §11.3：Memory/persona “不触及”，archive 将为其提供事实基础                                               | 当前 Life memory 是进程内 Map，persona string loading 直接 throw；archive 尚不存在                                                                                                | **目标约束，不是证明**。                                                                                                                             |
| §7：三级打断由 `stopWhen`/`AbortSignal`，tool result 无损进入下一帧                                      | 当前无 `generateText`/tool-loop/stopWhen/AbortSignal path in CortexChat；AI group 也明确不执行 loop                                                                               | **未实现**。AI SDK API 可用不等于 Athena Cortex 已接线。                                                                                             |
| §13 Phase D：用 `cacheReadTokens/cacheWriteTokens` 验收 prompt-cache                                     | 当前无 assistant entry usage，也无真实 LLM integration；roadmap 明确未做端到端真实 `generateText`（`docs/06-progress-and-roadmap.md:196-204`）                                    | **未验证**。                                                                                                                                         |
| Spec 顶部“Approved”                                                                                      | 顶部同时写“尚未实现”（`.specify/specs/perception-protocol-and-session-design.md:1-7`），而正式 docs 明确 spec 记录设计演进且权威低于 current code/docs                            | **状态语义冲突**：Approved = design decision，不是 shipped behavior。                                                                                |

## 5. 对七个场景的总判定

1. **日常对话**：transport 和最小 echo 可运行；context construction 只有单条消息，真实 Memory/LLM/session/cache 不存在。
2. **长时编程**：外部探索证明应区分 user/tool/history/error；Athena 当前没有 tool registry、tool-loop、sandbox 或 execution record。
3. **游戏/具身**：设计证据充分说明动态 world view、行为日志、frame snapshot 与 partial tool history 的必要性；Athena 当前没有 Minecraft/world capability，Sandbox 仍是 Satori bridge。
4. **自发行为**：正式架构将 rhythm/heartbeat 归 Cortex；当前无 World Cortex、无 autonomous tick。
5. **多频道/多 Nerve 并发**：Cordis group + MessageService Session filter + Sandbox Hub routing 已提供部分 isolation/transport；没有 per-channel serialization、stable Life id、Perception filter 或 cross-scene session。
6. **记忆整合/离线批处理**：当前仅 MemoryStub；Cyber/MaiBot 证明 SQLite/WAL、scope-aware retrieval、bounded reflection/writeback 是真实系统边界；Athena archive/session 尚不存在。
7. **长时研究**：AIService 有 embedding/reranking model seam，但没有 web retrieval/document chunk/citation/archive/context budget implementation；所有研究循环结论只能标 `[代码推断]/[无法验证]`。

**最终结论**：不要把 D-37~D-41 的“Perception → Session → frame/cache”描述当作当前 Athena context pipeline。当前最可靠的事实是：Life 保存身份材料，Capability/Nerve 把世界接入并负责作用域/传输，CortexChat 目前只做 raw Session echo，AIService 只解析全局模型；真正的 per-request context construction 和七场景所需的生命周期、并发、cache、tool、archive 语义仍是待落地设计。
