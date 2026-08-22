# MaiBot：从人格化聊天 Agent 到数字生命平台的架构研究

> **研究对象**：`/home/workspace/references/MaiBot`（下称 MaiBot）  
> **Athena 比较基准**：`/home/workspace/athena-harness` 当前代码与正式 `docs/`，不使用 `.specify/specs/` 作为现状依据。  
> **结论标签**：`已实现事实` = 源码直接可核验；`文档计划` = Athena 正式 roadmap 中明确但未落地；`代码推断` = 由已实现控制流得出的架构判断；`无法确认` = 本次静态追踪不能证明。  
> **证据边界**：本报告只做静态代码、依赖、配置与启动路径检查；未启动 MaiBot，故不主张任何外部适配器、模型或插件在特定部署中实际连通。

## 关键结论与证据索引

| 结论                                                                                                                                                         | 标签                  | 关键证据                                                                                                                                                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MaiBot 的核心运行单元是按 `session_id` 创建的 `MaisakaHeartFlowChatting`，不是跨媒介、可替换的实体 primitive。                                               | 已实现事实 / 代码推断 | `src/chat/heart_flow/heartflow_manager.py:21-45`；`src/maisaka/runtime.py:139-223`                                                                                                     |
| 入站已具备 Platform IO 的 `InboundMessageEnvelope`、`RouteKey(platform, account_id, scope)`、路由、去重和异步转交，但主认知链仍固定落入聊天消息处理。        | 已实现事实            | `src/platform_io/types.py:32-207`；`src/platform_io/manager.py:458-514`；`src/plugin_runtime/integration.py:137-153`                                                                   |
| 人格主要是全局 `global_config.personality` 的 prompt 字段；它不是独立的、可持久演化的 Life object。                                                          | 已实现事实 / 代码推断 | `src/config/config.py:763-788`；`src/config/official_configs.py:189-280`；`src/maisaka/chat_loop_service.py:609-773`                                                                   |
| 会话短期上下文可从 DB 恢复；长期 memory 通过 A_Memorix、人物画像和启发式召回作为每轮 prompt 注入。                                                           | 已实现事实            | `src/maisaka/runtime.py:316-401`；`src/maisaka/reasoning_engine.py:492-531,696-740`；`src/maisaka/memory/person_profile.py:222-271`；`src/maisaka/memory/heuristic_injector.py:64-220` |
| Planner 使用 tool-call 循环；tool result、发送成功后的消息、投递回执与 memory 写回均会反流，但不是统一的跨 Nerve enactment protocol。                        | 已实现事实 / 代码推断 | `src/maisaka/reasoning_engine.py:640-685,2030-2128`；`src/services/send_service.py:824-968`                                                                                            |
| `wait` 与插件 `enqueue_proactive_task()` 能继续/主动唤醒会话级循环；这是一种聊天节律，不是全局持续 world heartbeat。                                         | 已实现事实 / 代码推断 | `src/maisaka/runtime.py:589-685,1664-1826`；`src/maisaka/reasoning_engine.py:999-1043`                                                                                                 |
| 插件 Runtime 以两个 Runner 子进程、IPC、hook、capability 和 component 注册实现隔离/扩展；但其公开能力大量是宿主 API，不能替代 Life/Cortex/Nerve 的领域组合。 | 已实现事实 / 代码推断 | `src/plugin_runtime/integration.py:99-153,626-679`；`src/plugin_runtime/capabilities/registry.py:13-45`；`src/plugin_runtime/runner/runner_main.py:1232-1246`                          |
| Athena 已有 per-Life 隔离、one-Cortex-per-Life、Cortex/Capability 分层；但认知、memory persistence、tool registry、world/interlude Cortex 尚未实现。         | 已实现事实 / 文档计划 | `plugins/life/src/life.ts:4-58`；`plugins/cortex-chat/src/index.ts:15-44`；`docs/02-architecture.md:215-289`；`docs/06-progress-and-roadmap.md:55-68,231-290`                          |

---

## 1. 项目定位与核心抽象

### MaiBot

- **已实现事实**：项目包元数据将 MaiBot 定义为“基于大语言模型的可交互智能体”；运行依赖同时包含 `maim-message`、`maibot-plugin-sdk`、`sqlmodel`、`faiss-cpu`、`mcp` 等（`pyproject.toml:5-47`）。README 把 MaiSaka 定位成追求“human style”的数字生命式聊天 Agent，并宣称 plugin/event system 可扩展（`docs/README_EN.md:27-37`）；但这只是产品叙述，架构判断以下列代码为准。
- **已实现事实**：主业务对象 `MaisakaHeartFlowChatting` 构造时需要一个既有 `session_id`，从 `chat_manager` 找到 `BotChatSession` 后建立该聊天流私有的 `_chat_history`、`message_cache`、内部 trigger queue、工具注册表和推理引擎（`src/maisaka/runtime.py:139-223`）。`heartflow_manager` 以 `OrderedDict[str, MaisakaHeartFlowChatting]` 缓存这些对象，并按 `session_id` 懒创建和启动（`src/chat/heart_flow/heartflow_manager.py:21-45`）。
- **代码推断**：MaiBot 的本体是“一个配置驱动的 MaiSaka + 多个聊天流运行时”，而非“多种独立 Life 各自持有 identity、memory、Cortex、Nerve”的平台。因此人格化主要是一个应用层行为策略：全局 persona/行为 prompt + 每个聊天流状态 + 对人的 memory，而不是 runtime primitive。

### Athena 对照

- **已实现事实**：Athena 的正式定义是 `Life`（identity）、`Cortex`（完整生存策略）和 `Nerve`（世界双向通道）（`docs/00-overview.md:9-29`；`docs/01-design-philosophy.md:33-145`）。当前 `Life` 已有 `persona`、`memory` 字段并强制 one-Cortex-per-Life（`plugins/life/src/life.ts:21-58`）。
- **评价**：MaiBot 的“聊天流就是运行单元”非常适合拟人群聊；Athena 的“实体不是聊天流”才是支撑多媒介存在和多种生命形态的必要边界。

## 2. 事件输入与世界接口

### MaiBot

- **已实现事实**：Platform IO 抽象了 `RouteKey`（`platform`、可选 `account_id`、`scope`）与 `InboundMessageEnvelope`（`src/platform_io/types.py:32-207`）。`PlatformIOManager` 维护 driver registry、收发路由表、去重器、outbound tracker 和全局 inbound dispatcher（`src/platform_io/manager.py:26-47`）。入站先检查 receive route、再按 key 去重、最后 `asyncio.create_task` 后台分发（`src/platform_io/manager.py:458-514`）。
- **已实现事实（端到端入站链）**：插件驱动产生 envelope 后，`PluginRuntimeManager._dispatch_platform_inbound()` 还原/取得 `SessionMessage` 并调用 `chat_bot.receive_message()`（`src/plugin_runtime/integration.py:137-153`）；`ChatBot.receive_message()` 计算会话 ID、做 media 处理、可被前后 hook 改写/中止、执行过滤与 command 分流、注册/创建 `BotChatSession`，最后交给 `HeartFCMessageReceiver.process_message()`（`src/chat/message_receive/bot.py:717-864`）。后者写入消息 DB、获取该 `session_id` 的 heartflow runtime、调用 `chat.register_message(message)` 并注册人物（`src/chat/heart_flow/heartflow_message_processor.py:24-94`）。
- **已实现事实**：`ChatManager` 的 session ID 由 `platform + user_id + group_id + account_id + scope` 计算；session identity 会持久化进 `ChatSession`，同时内存中维护 `sessions` 和 `last_messages`（`src/chat/message_receive/chat_manager.py:82-199`）。
- **代码推断**：Platform IO 是有潜力的通用世界接入层，但当前正式入站只有“规范化消息 → `chat_bot.receive_message`”这一硬接线。`InboundMessageEnvelope.payload` 无论来自哪个 plugin，最终仍要成为 `SessionMessage`（`src/plugin_runtime/integration.py:137-153`）。故它是多平台 IM routing，而不是多模态 sense interface。

### Athena 对照

- **已实现事实**：Athena 把 messaging 封在 `ctx.message`；MessageService 内部维护 Satori bot registry 和发信 API（`plugins/capability-message/src/index.ts:28-106`）。Cortex 通过 capability token 订阅事件，而不依赖具体 adapter（`docs/02-architecture.md:142-149`）。
- **评价**：应借鉴 MaiBot 的 route key、去重、delivery receipt 和 driver lifecycle；不应把 `SessionMessage` 上升成 Athena 的统一世界对象。Athena 的世界输入应按 Nerve/Capability 语义表达，IM 只是一种输入。

## 3. 上下文与状态模型

### MaiBot

- **已实现事实**：每个 heartflow runtime 有 `_chat_history`、`message_cache`、内部 `Queue["message", "timeout", "proactive"]`、wait 状态、工具发现集和 `ToolRegistry`（`src/maisaka/runtime.py:160-223`）。这种隔离发生在聊天流层。
- **已实现事实**：启动运行时时，`_restore_recent_context_from_db()` 以当前 `session_id` 读取近期消息、跳过通知、重建 `LLMContextMessage`、再附上一条带离线时长语义的 `CONTEXT_RESTORE` reference message（`src/maisaka/runtime.py:316-401`）。这实现了短期对话的重启恢复。
- **已实现事实**：核心关系型 DB 固定为进程项目目录下 `data/MaiBot.db` 的 SQLite，使用全局 SQLAlchemy engine/session factory 与 migration bootstrapper（`src/common/database/database.py:26-74,122-209`）。A_Memorix 则由单例 `AMemorixHostService` 管理一个共享 `SDKMemoryKernel`，有 startup state、锁与 runtime config 缓存（`src/A_memorix/host_service.py:93-170`）。
- **代码推断（表面平台化的边界）**：`ChatManager`、`memory_service`、`heuristic_memory_injector`、`a_memorix_host_service` 都以模块级单例出现（分别见 `src/chat/message_receive/chat_manager.py:82-87,541`、`src/services/memory_service.py:92-500`、`src/maisaka/memory/heuristic_injector.py:54-62,406`、`src/A_memorix/host_service.py:93-100,968`）。即使数据可按 `session_id`/person ID 筛选，存储 backend、全局配置、人格与模型策略仍是单进程共享；它不是多 Life 隔离模型。

### Athena 对照

- **已实现事实**：Athena 多 Life 用 Cordis group isolate `{ life, cortex, message, satori }`，并清晰界定生命周期与冲突风险（`docs/02-architecture.md:215-289`）。
- **已实现事实**：当前 `Life.memory` 仅是 in-memory `MemoryStub`，`search()` 永远返回空；persona 只支持 inline object（`plugins/life/src/life.ts:4-52`）。
- **评价**：MaiBot 明显领先于 Athena 的现状：真实 DB、短期上下文恢复、长期记忆。Athena 不应复制 MaiBot 的 process-global singleton；应把持久化 backend 共享与 Life memory ownership 分开，所有 memory query/write 都必须显式带 Life scope 与可审计的 visibility policy。

## 4. 核心认知与 LLM 调用

### MaiBot

- **已实现事实**：`MaisakaChatLoopService` 实时以 `global_config.bot.nickname`、`global_config.personality.behavior_style`、聊天类型注意事项、工具说明和 memory-query rule 渲染系统 prompt（`src/maisaka/chat_loop_service.py:609-773`）；`_build_request_messages()` 再将该 system prompt、精选 history、时间提示和本轮 reminder 组为 Context Items（`src/maisaka/chat_loop_service.py:889-1023`）。
- **已实现事实（Persona 如何进入 prompt）**：这里可直接证实进入 prompt 的“人格”是 `global_config.personality.behavior_style` 和相关配置字符串，而不是一个以 `life_id` 解析的 Persona 实体（`src/maisaka/chat_loop_service.py:634-637,745-773`）。`PersonalityConfig` 是 `official_configs.py` 中的配置类（`src/config/official_configs.py:189-280`）。
- **已实现事实（Memory/Profile 如何进入 prompt）**：Reasoning engine 在每次 planner 请求前并行构造 heuristic-memory 与 person-profile 注入，再传给 `_run_interruptible_planner()`（`src/maisaka/reasoning_engine.py:492-531,696-740`）。人物画像按私聊当前用户、或群中最近发言者/@/引用对象选至多三个，然后经 `memory_service.profile_admin(action="query")` 形成“内部参考”（`src/maisaka/memory/person_profile.py:146-271`）。
- **已实现事实（隔离规则）**：heuristic memory 默认按当前 `session_id` 搜索；跨 chat 只有配置显式启用才传空 `chat_id`，并额外阻止未允许的 group↔private 流向；人物事实只对当前窗口 active person IDs 可见（`src/maisaka/memory/heuristic_injector.py:184-321`）。
- **已实现事实（何时更新）**：发送成功后 `send_service` 调用 `memory_automation_service.on_message_sent()`；其两条 bounded queue worker 分别抽取人物事实和在消息阈值到达时生成 chat summary，写入失败只记录 warning，队列满会丢弃该次任务（`src/services/send_service.py:751-763,915-919`；`src/services/memory_flow_service.py:29-75,427-540,666-698`）。
- **已实现事实**：主 planner 的模型调用可被新消息打断；`_run_interruptible_planner()` 安装 interrupt event，调用 `chat_loop_step()`，finally 中解绑（`src/maisaka/reasoning_engine.py:191-220`）。主循环最多 `MAX_INTERNAL_ROUNDS = 10`（`src/maisaka/runtime.py:76-91`；`src/maisaka/reasoning_engine.py:999-1043`）。
- **代码推断**：MaiBot 的“人格/数字生命”核心来自 prompt 编排、群体学习、记忆注入和决策节律，属于丰富的应用逻辑/配置层能力，而非不依赖聊天运行时的核心 primitive。其实际强项是上述层的成熟度，不是 identity 的模块边界。

### Athena 对照

- **已实现事实**：Athena `CortexChat` 当前只按消息回显 `[persona.name] Echo`，尚没有 LLM、willingness、buffer 或 tool loop（`plugins/cortex-chat/src/index.ts:15-44`；`docs/06-progress-and-roadmap.md:23-30,231-254`）。AIService 虽已完成，但“Cortex 侧 AI SDK 集成”仍列为未开始（`docs/06-progress-and-roadmap.md:55-63`）。
- **评价**：Athena 应优先借鉴 MaiBot 的“每次 cognition 前以结构化 reference message 注入 profile/memory、并按隐私 scope 过滤”的做法；但 Persona 应由 `Life` 持有，不能退化成 `global_config.personality`。

## 5. 行动输出与反馈闭环

### MaiBot

- **已实现事实**：`ToolRegistry` 有 `ToolProvider` protocol、availability/execution context、LLM definition 转换、按 provider 顺序去重列举和受保护的 `invoke()`（`src/core/tooling.py:83-419`）。每个 heartflow runtime 注册 builtin、plugin 与 MCP 三类 provider（`src/maisaka/runtime.py:1353-1361`）。
- **已实现事实**：Reasoning engine 先选择本轮可见 action tools；模型返回 tool calls 后，按序调用 registry，记录耗时，写 ToolExecutionRecord、将成功/失败内容作为 `ToolResultMessage` 追加至 `_chat_history`，然后继续下一内部轮或按结果 pause（`src/maisaka/reasoning_engine.py:449-490,640-685,2030-2128`）。这是明确的 LLM → action → observation → LLM 闭环。
- **已实现事实**：发送动作统一经过 send hook、Platform IO route/driver、成功 receipt 的平台 message ID 回填、adapter callback、DB 持久化、memory writeback；可选地把成功消息同步回 heartflow history（`src/services/send_service.py:824-968`）。
- **已实现事实**：Platform IO 保存 pending outbound 与 receipt 的短时 in-memory tracker（`src/platform_io/outbound_tracker.py:21-57,81-165`）；失败则在 send service 返回 `None` 并记录 route/driver failure（`src/services/send_service.py:808-934`）。
- **代码推断**：行动结果对同一会话的认知是充分回流的，然而 output model 的中心仍是 `SessionMessage`/message sending。其他类型 tool 可以通过 MCP/plugin 返回内容，但没有证据表明它们被建模为可复用的世界 action contract 或 Nerve feedback。

### Athena 对照

- **文档计划**：Athena Phase 2-C 目标是 `generateText` tool-loop、`send_message`/`wait` Layer 2 tools、未来 `ctx.tools` 的作用域发现与统一 execute，随后经 `ctx.message.createMessage` enact（`docs/06-progress-and-roadmap.md:193-198,231-245`）。
- **评价**：Athena 应吸收 MaiBot “result 写回 history、outbound receipt 回填、成功后才触发 memory writeback”的因果次序；同时把 output 结果归到发起 action 的 Nerve 与 Life，而不是只归 `session_id`。

## 6. 生命周期、并发与可靠性

### MaiBot

- **已实现事实**：启动路径为 `bot.py` 的 Runner/Worker 分进程入口，Worker 导入 `MainSystem`（`bot.py:79-149,441-553`）；`MainSystem._init_components()` 并行启动 plugin runtime、A_Memorix 和 emoji load，随后初始化 chat manager、memory automation，发 `ON_START`，最后 `schedule_tasks()` 并发跑消息 API/server/维护任务（`src/main.py:103-244`）。
- **已实现事实**：Platform IO 启动任一 driver 失败时会逆序 rollback；stop 会取消未完成 inbound tasks、清掉 dedupe 和 outbound tracker（`src/platform_io/manager.py:58-122`）。
- **已实现事实**：每个 session runtime 用单一 internal queue 处理 message/timeout/proactive trigger；wait 会建立 timeout task 再将 `timeout` 放回 queue（`src/maisaka/runtime.py:1664-1826`）。主 Planner 可被新消息 interrupt，随后等待 debounce、合并新消息后重试（`src/maisaka/reasoning_engine.py:755-814`）。runtime 发现 loop task 已异常结束会自动重启（`src/maisaka/runtime.py:1314-1332`）。
- **已实现事实**：内存写回 worker 与部分 learner 使用 queue/task，并对异常 catch/log；人物事实和摘要 queue 均是 size 256，满时直接跳过（`src/services/memory_flow_service.py:29-75,427-475`）。
- **评价**：这是明显成熟的 per-chat serialization / cancellation / restart 工程；它也说明 MaiBot 的“主动性”不是一个不间断的 agent daemon，而是一组由消息、wait timeout、focus/idle 规则唤醒的 session loops。

### Athena 对照

- **已实现事实**：Athena 明确把节律和并发策略划入 Cortex，不提供全框架 mailbox/queue；push event 可能并发，Cortex 必须自己实现串行/锁/幂等（`docs/01-design-philosophy.md:177-228`）。
- **评价**：Athena 原则正确；P1 应建立可复用但不强制的 Cortex recipe：per-Life/per-channel serial executor、cancellation、bounded buffering、attempt trace。不要把 MaiBot 的 chat queue 误升为全框架 queue primitive。

## 7. 扩展性与平台化能力

### MaiBot

- **已实现事实**：Plugin runtime 分 builtin 与 third-party 两个 Supervisor/Runner 子进程，并配置 hook spec registry、hook dispatcher、插件源/配置 watcher；启动时把 Platform IO dispatcher 接入、启动 supervisors、注册 config reload callback（`src/plugin_runtime/integration.py:99-153,626-679`）。Runner 通过 RPC 提供 command/action/API/tool/message_gateway/LLM provider/event/hook/health/shutdown 等入口（`src/plugin_runtime/runner/runner_main.py:1232-1246`）。
- **已实现事实**：宿主 capability registry 对插件暴露 send、LLM、config、database 等能力（`src/plugin_runtime/capabilities/registry.py:13-45`），并有 capability authorization token（`src/plugin_runtime/host/authorization.py:29-33`）。Planner hooks 能改写 Context Items 和 tool definitions（`src/maisaka/chat_loop_service.py:162-280,1030-1079`）。
- **已实现事实**：`PlatformIOManager` 可运行时 add/remove driver，并有显式路由绑定和 legacy fallback（`src/platform_io/manager.py:124-167,350-444`）。
- **代码推断（看似平台化但实际宿主中心）**：插件隔离和 IPC 很强，然而它扩展的是一个固定 MaiBot host 的消息/LLM/DB 功能；核心 conversation path 仍硬编码 `PluginRuntimeManager → chat_bot.receive_message → HeartFCMessageReceiver → MaisakaHeartFlowChatting`。没有发现插件可声明新的 `Life`、替换一个独立 Cortex、或把新 world interface 以同等地位与 IM 合成的 contract。因此它是高度可扩展的聊天 Agent host，不是可构造多种数字生命的平台。

### Athena 对照

- **已实现事实**：Athena 的插件包结构把 `cortex-*`、`nerve-*`、`capability-*` 作为不同角色；Cortex 依赖 capability 而永不依赖 Nerve/adapter（`docs/02-architecture.md:92-164`）。
- **文档计划**：Hook Protocol、`ctx.tools` scope、World/Interlude Cortex 与非 IM capability 还未开始（`docs/06-progress-and-roadmap.md:55-68,210-245,294-315`）。
- **评价**：Athena 应借鉴 MaiBot 的 manifest/RPC permission/hook timeout/runner supervision，但不得让 plugin runtime 反向定义实体模型。插件只能扩充 Nerve、Capability 或 Cortex 的已定义边界，不能重新把“message handler”设为中心。

## 8. 工程质量与风险

### MaiBot

**工程优势（已实现事实）**

1. 统一 Platform IO route、receipt、dedupe 与 driver lifecycle（`src/platform_io/manager.py:26-47,458-514`）。
2. session-level Queue、planner interrupt、bounded internal rounds、wait timeout、loop restart（`src/maisaka/runtime.py:166-223,1314-1332,1664-1826`；`src/maisaka/reasoning_engine.py:999-1043`）。
3. prompt、tool、output item、plugin hook 都有明确模型；tool exception 转为结构化失败，而不会崩掉所有会话（`src/core/tooling.py:363-413`）。
4. 长期 memory 有检索 scope 校验和异步写回；短期历史跨重启恢复（`src/maisaka/memory/heuristic_injector.py:260-321`；`src/maisaka/runtime.py:316-401`）。

**风险（已实现事实 / 代码推断）**

1. **全局单主体配置**：`global_config` 的稳定代理在 import 时创建（`src/config/config.py:763-788`），planner 将 bot name/behavior style 从其读取（`src/maisaka/chat_loop_service.py:634-773`）。**代码推断**：同一进程内要有不同人格、不同模型伦理/行为策略的多个独立主体，不能只靠现有 session scope 完成。
2. **全局共享服务**：chat manager、memory service、A_Memorix host 与 heuristic recall singleton（见第 3 节证据）。**代码推断**：数据 filtering 不等同于 ownership isolation；错误的 caller scope 或 global config 改动会跨“主体”影响。
3. **memory 写回非可靠事务**：bounded queue 满时会跳过，worker 异常仅 warning（`src/services/memory_flow_service.py:56-75,454-475`）。这适合可丢的学习，不足以承担 identity-critical memory 的一致性承诺。
4. **IM 假设仍渗入核心**：`SessionMessage`、群/私聊、@、reply、typing、emoji 的字段穿过 planner、tools、persistence 与 output（例如 `src/maisaka/runtime.py:1205-1284`、`src/services/send_service.py:648-679`）。**代码推断**：将其移植到 Minecraft/Live2D/物理身体，不能仅添加 driver。
5. **未确认**：静态检查无法确认第三方 plugin SDK 在真实非 IM world integration、跨进程故障恢复、或跨主体 memory isolation 上的运行结果；不得把存在 RPC/capability 接口等同于生产可用的多生命组合能力。

## 9. 与 Athena Harness 的逐项比较

### Athena 已明显领先

1. **领域组织原则**：Athena 将持续 identity、策略和世界接口明确分为 `Life/Cortex/Nerve`，并规定 Cortex 只依赖 capability、Nerve 实现 capability（`docs/01-design-philosophy.md:35-120,149-173`；`docs/02-architecture.md:142-149`）。MaiBot 当前的核心单元是聊天流 runtime，难以把“我是谁”从“与某群如何聊天”中分离。
2. **多主体隔离语义**：Athena 已落地 Cordis group isolate 和 one-Cortex-per-Life，且对 `life/cortex/message/satori` 四个隔离 token 的失败模式有直接说明（`plugins/life/src/life.ts:35-45`；`docs/02-architecture.md:215-289`）。MaiBot 的 `RouteKey`/`session_id` 是路由与数据分桶，不是 identity boundary。
3. **非 IM 的原则地位**：Athena 明确拒绝 messaging 成为 framework identity，并使 Satori 仅为 capability 内实现（`docs/01-design-philosophy.md:232-296`）。

### Athena 设计正确但尚未实现

1. **Life 持久化与可演化 memory/self-model**：正式 Phase 3 计划 SQLite `MemoryProvider`、persona file、self-model（`docs/06-progress-and-roadmap.md:258-290`）。
2. **真正 Cognition/Enactment**：Phase 2-C 已明确 willingness、buffer、per-channel lock、LLM tool-loop、send/wait、hook（`docs/06-progress-and-roadmap.md:231-254`）。
3. **多形态持续节律**：Continuous World heartbeat、Narrative Interlude 和非 IM capabilities 均在 Phase 4（`docs/00-overview.md:31-37`；`docs/06-progress-and-roadmap.md:294-315`）。

### Athena 当前明显不足

1. **可运行认知链**：当前 CortexChat 只是 echo（`plugins/cortex-chat/src/index.ts:15-44`），MaiBot 已有可打断 Planner、工具循环、历史与结果回流。
2. **Memory 工程**：Athena MemoryStub 不搜索、不持久化；MaiBot 已有 SQLite 主消息库、A_Memorix kernel、profile/summary writeback 和 privacy-aware recall（`plugins/life/src/life.ts:4-19`；MaiBot 证据见第 3/4 节）。
3. **工程化行动反馈**：Athena 尚无 tool registry/Execution Record；MaiBot 已有 ToolRegistry、tool DB record、receipt 回填和 planner monitor（`docs/06-progress-and-roadmap.md:55-68`；`src/maisaka/reasoning_engine.py:1576-1675,2030-2128`）。
4. **主动节律的具体实现**：Athena 有正确的 Cortex ownership 原则但未有 World Cortex；MaiBot 已提供 wait timeout、idle/focus 和 plugin proactive task（`src/maisaka/runtime.py:589-685,1664-1826`）。

### 对方值得借鉴

1. 将 `RouteKey(account_id, scope)`、inbound dedupe、outbound receipt 作为 Message Capability/Nerve 的传输层细节，而不是塞进 Cortex（MaiBot `src/platform_io/types.py:32-207`、`manager.py:458-514`）。
2. 建立 Cortex 内部 `ExecutionRecord`：记录输入 snapshot、model attempt、tool calls/results、delivery receipt、end reason；MaiBot 的 `emit_planner_finalized()` payload 与 tool monitor result 是直接参照（`src/maisaka/reasoning_engine.py:946-997,1955-2028`）。
3. Memory 按“召回 scope + 可见性检查 + source provenance + 异步 writeback”设计；尤其借鉴 group/private direction gate（`src/maisaka/memory/heuristic_injector.py:260-321`）。
4. 后台任务必须具备 cancellation、bounded queue、restart/rollback 路径；同时明确哪些 learning 允许 drop、哪些 identity mutation 不允许 drop（`src/services/memory_flow_service.py:29-75`）。

### 不应照搬

1. 不照搬 `global_config.personality` prompt 作为 Persona：这会让 Life 退化为启动配置，违背 Athena 对跨 Cortex identity 的要求（Athena `docs/01-design-philosophy.md:35-63`）。
2. 不照搬“每个 chat 一个事实上的 agent runtime”：它可以成为 Chat Cortex 的局部 session state，但不能成为 Life 的边界。
3. 不照搬 process-global `memory_service` / `a_memorix_host_service` ownership。Athena 可以共享数据库和向量索引实例，但需在 API、records 和 access control 中强制 `lifeId`。
4. 不照搬把所有主动行为表达成伪 `SessionMessage`。MaiBot 的 plugin proactive task 明确构造“插件主动聊天任务”文本并放入 chat history（`src/maisaka/runtime.py:589-658`）；Athena World Cortex 应能消费原生 world perception。

### 可能误导的表面相似点

| 表面相似                                  | 实质差异                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 两者都有“数字生命”叙事和 persona/memory。 | MaiBot persona 是全局 prompt config、memory 主要围绕 chat/person；Athena 的目标是 Life primitive，当前只有最小 stub。      |
| 两者都有消息路由和多账号字段。            | MaiBot `RouteKey` 解决 transport routing；Athena isolate 解决 service/identity ownership。二者可互补，不可互换。           |
| 两者都有主动/等待。                       | MaiBot 是 session queue + `wait` timeout + plugin task；Athena 目标是由 Cortex 定义的多种 rhythm，包括无 IM 的 heartbeat。 |
| 两者都有插件和 tools。                    | MaiBot plugin runtime 是 host-centric IPC extension；Athena 的目标是 capability/nerve/cortex composition。                 |

---

## 对 Athena 开发方向与优先级的影响

### P0：完成可审计的 Chat Cortex 认知—行动闭环

- **建议**：按既定 Phase 2-C 实现 per-channel serial state、短聚合窗口、`generateText` failover、`send_message`/`wait`、tool result history、delivery receipt 和 `ExecutionRecord`；先把 Sandbox Nerve 跑通，不扩展额外能力。
- **依据**：Athena 当前只 echo（`plugins/cortex-chat/src/index.ts:15-44`），而其 roadmap 已定义此 contract（`docs/06-progress-and-roadmap.md:231-254`）。MaiBot 表明 `ToolResultMessage` 写回与成功 delivery 后写回 history 是稳定闭环的最低要求（`src/maisaka/reasoning_engine.py:1633-1675,2030-2128`；`src/services/send_service.py:824-968`）。
- **不做**：不要在 P0 把 MaiBot 的 session runtime、全局 prompt singleton 或 plugin IPC 搬入 Athena。

### P1：把持久化 Memory 做成 Life-scoped 基础设施，而非聊天附属物

- **建议**：实现 `MemoryProvider` 的 SQLite 后端与 persona file loading；每条 memory 必须记录 `lifeId`、source Nerve、visibility scope、时间、provenance 和写入状态。为 chat memory 制定 group/private/person 的 query policy，并把 recall 产物作为 Cortex integration 的结构化 reference。
- **依据**：Athena 已承认 Memory persistence/Persona file 未开始（`docs/06-progress-and-roadmap.md:258-290`）；MaiBot 启发式 recall 证明 source/scope filter 很关键（`src/maisaka/memory/heuristic_injector.py:184-321`），但其 global memory host 也暴露出 Athena 必须避免的 ownership 模糊。
- **不做**：不把有损的 bounded learning queue 用于 Life identity 的关键事实；可丢的风格/黑话学习与不可丢的自我状态必须分级。

### P1：完善 Message Capability/Nerve 的 transport reliability，但保持 Cortex 无感

- **建议**：在 `ctx.message` 或具体 Nerve 内采纳 route target、dedupe、delivery receipt、pending status 和 adapter lifecycle；Cortex 只获得 capability-level action result。
- **依据**：MaiBot Platform IO 的路由/回执控制流（`src/platform_io/manager.py:58-122,458-514`）可直接提升真实 IM 接入可靠性；Athena 的依赖倒置规则要求 Cortex 不依赖 adapter（`docs/02-architecture.md:142-149`）。

### P2：为可组合生态加入受限 Hook/Plugin runner，而非抢跑全平台

- **建议**：先落地 roadmap 的五个 typed Hook，配一个 `before-enact` filter 插件；再评估是否需要 MaiBot 式 runner process、manifest、capability permission 与 hot reload。
- **依据**：Athena Hook Protocol 尚未开始（`docs/06-progress-and-roadmap.md:210-229`）；MaiBot 的 typed hook 与 IPC isolation 提供可借鉴的工程实现（`src/plugin_runtime/integration.py:99-153`；`src/maisaka/chat_loop_service.py:162-280`）。
- **暂缓事项**：独立 plugin subprocess runtime、双 Supervisor、全套 host capability API。它们解决的是陌生 third-party code 的进程隔离，不是当前证明 Life/Cortex/Nerve 可组合性的前置条件。

### P2：以第二种 Cortex 验证抽象，而不是把 Chat Cortex 继续加厚

- **建议**：当 P0/P1 基础完成后优先实现一个最小 `cortex-world`：无 IM event 也运行的 heartbeat、原生 perception mailbox、一次 tool/action、result feedback；以此验证 Life memory 是否真的跨 Cortex/Nerve 成立。
- **依据**：Athena 的不退化判据明确要求非 IM capability 不是二等公民、主动行为不能是 event-response 的补丁（`docs/00-overview.md:156-165`），而 MaiBot 的所有 proactive 路径最终仍回到 session planner（`src/maisaka/runtime.py:589-685`）。
- **暂缓事项**：在尚未实现 World Cortex 前，不要把“wait timeout”宣传为完整 continuous digital life；它只证明聊天循环的延续。
