# CyberGroupmate 研究报告：从群聊社会 Agent 到可组合数字生命平台的启示

> **研究对象**：`/home/workspace/references/CyberGroupmate`（以下称 CyberGroupmate）  
> **Athena 比较基准**：Athena Harness 当前代码与 `docs/00`–`06`；不把 `.specify/specs/` 作为现行架构依据。  
> **证据边界**：本报告直接检查了入口、adapter、队列/Agent、Sandbox、SQLite memory、Reflection、配置、依赖与启动说明；未启动参考项目，故所有“运行时实际已连通”仅指源码调用关系已闭合，不声称在本环境成功接入真实平台。  
> **标记约定**：**[已实现事实]** 可由当前代码直接证实；**[文档计划]** 仅来自配置注释/README；**[代码推断]** 是由结构导出的解释；**[无法确认]** 表示未能从可得代码确定；**[评价]** 与 **[建议]** 不等同于事实。

## 关键结论与证据索引

| 结论 | 状态 | 核心证据 |
| --- | --- | --- |
| CyberGroupmate 是单进程、配置驱动的多平台群聊社会 Agent application，而不是可被第三方组合的 runtime framework。 | **[已实现事实]** + **[代码推断]** | `package.json:9-20` 以 `tsx src/main.ts` 为唯一应用入口；`src/main.ts:260-480` 在 bootstrap 中直接装配 config、memory、adapter、Sandbox；`src/adapter/platform-adapter.ts:75-110` 是应用内 adapter interface，而非独立 package/plugin contract。 |
| 状态的主要隔离单位是 composite `chatId`，但 Discord 的 group model 有意按 guild 聚合；人的 identity/profile 同时有跨群与群内两层。 | **[已实现事实]** | `src/core/chat-id.ts:51-130,188-195`；`src/memory-v2/memory-v2.ts:369-440`。 |
| 主链为 adapter 标准化 `nc.message` → 即时 SQLite 落盘/每 chat `GroupSubagent` → `AttentionAccumulator` → `MainAgentLoop`/Meta-CodeAct → per-chat `CodeActExecutor`/Sandbox → adapter host call；输出消息再以 `system.agent_message_sent` 回写 memory/pipeline。 | **[已实现事实]** | `src/adapter/telegram-adapter.ts:138-180,452-468`；`src/main.ts:656-938,1056-1223`；`src/main-agent/main-agent-loop.ts:180-425`；`src/subagent/code-act-executor.ts:759-1089`；`src/sandbox/host-call-handler.ts:501-532`。 |
| Meta 与每 chat 的 CodeAct session 均有可持久化历史；社会记忆使用 SQLite/WAL，并有 Reflection 将消息/interaction 归纳成画像、facts、relationship episodes 与 group feedback。 | **[已实现事实]** | `src/subagent/subagent-manager.ts:63-67,114-211`；`src/subagent/code-act-executor.ts:1542-1625`；`src/memory-v2/memory-v2.ts:204-253,340-657`；`src/memory-v2/reflection.ts:225-610`。 |
| 其主动性不是“永续世界 Cortex”，而是 attention、reminder/cron、idle、reflection 与可选外部 harness 的多触发编排。 | **[已实现事实]** + **[代码推断]** | `src/main.ts:951-1054,1455-1608,1393-1410`；`src/main-agent/main-agent-loop.ts:264-288`。 |
| 输出反馈闭环在“Agent 已发送消息”这一层有明确回灌；但不能从 inspected source 证明平台收到/用户理解/关系改善等外部结果被可靠关联到某次行动。 | 前半 **[已实现事实]**；后半 **[无法确认]** | `src/main.ts:665-732`；`src/subagent/code-act-executor.ts:1040-1073`；`src/main-agent/main-agent-loop.ts:191-257`。 |
| Athena 的 Life/Cortex/Nerve 与 isolate 方向更适合作为多数字生命平台的骨架，但当前缺失持久 Memory、真实 cognition、tool registry、主动 Cortex；CyberGroupmate 的成熟社会 memory 不应倒灌为 Athena 核心架构。 | 前半 **[已实现事实]**；结论 **[评价]** | Athena：`docs/00-overview.md:9-37,60-90`、`docs/02-architecture.md:168-289`、`docs/06-progress-and-roadmap.md:55-68,231-290`；CyberGroupmate 证据如上。 |

---

## 1. 项目定位与核心抽象

### 1.1 定位判断

- **[已实现事实]** 项目自身将入口文件描述为“Orchestrator / Main Agent ↔ Subagent Architecture”，并把流程写成 `PlatformAdapter → NC → ... → MainAgentLoop → DecisionMaker → CodeActExecutor → Q5 → GlobalState`；主 Agent 是持有全局上下文的串行决策层，Subagent 是 per-group 的慢层执行者。证据：`src/main.ts:1-11`。
- **[已实现事实]** `main()` 直接创建 configuration、SQLite memory、平台 adapter、`SandboxPool`、`SubagentManager`、`GlobalState`、`AttentionAccumulator`、`MainAgentLoop` 与 Dashboard，显示其 runtime composition 固定在应用 bootstrap 而非由外部宿主以插件树装配。证据：`src/main.ts:260-480,496-623,1056-1223`。
- **[已实现事实]** 唯一明确的跨平台边界是 `PlatformAdapter`：连接、补抓、`handleCall()`、能力判定、媒体下载、已读等都被收敛在该 interface。证据：`src/adapter/platform-adapter.ts:75-110`。Telegram、Discord、OneBot 三个 concrete adapter 都将各自事件归一为 `nc.message`。证据：`src/adapter/telegram-adapter.ts:138-180,452-468`、`src/adapter/discord-adapter.ts:69-110,310-336`、`src/adapter/onebot-adapter.ts:119-165,1594-1598`。
- **[已实现事实]** Agent 的行为单元不是 JSON-schema tools，而是 LLM 在 per-chat Sandbox 中写 TypeScript/CodeAct；host-call handler 根据方法名分派 platform、memory、dispatch、cron、MCP 等能力。证据：`src/subagent/code-act-executor.ts:759-991`、`src/sandbox/host-call-handler.ts:501-760,1006-1113`。
- **[代码推断]** 因此它最准确的分类是**高可配置的、多平台群聊 companion / social Agent system**：它有丰富内部模块与 adapter extension seam，但没有把“identity—cognition strategy—world connection”提炼为可由多个数字生命并存、替换、组合的稳定公共原语。`persona` 是全局 `AppConfig` 的一份 name/description，而非具有独立生命周期的实体实例。证据：`src/core/config.ts:149-157`、`src/main.ts:1211-1219`。

### 1.2 模块边界与扩展路径

- **[已实现事实]** 平台扩展：实现 `PlatformAdapter`，然后在 `main.ts` 以 `if (appConfig.<platform>) new <Adapter>(...)` 硬编码接入。证据：`src/main.ts:453-480`。这是一条明确但**非动态发现/插件注册**的扩展路径。
- **[已实现事实]** 技能扩展：Sandbox 的 API 概览由 `ModuleEntry` registry 与 `workspace/skills/` 共同提供，错误后可查 full docs；`config.example.yaml` 的 `subagent.base_skills` 列出了 runtime、memory、actions、MCP、cron、events、KV、HTTP、vision、shell 等。证据：`src/subagent/code-act-executor.ts:203-286,768-790,980-989`；`config.example.yaml:430-481`。
- **[已实现事实]** LLM 扩展：`llm_profiles` 定义 provider/key/model，`llm_routing` 按 meta/session/recording/reflection 等组件选择 profile 或 fallback chain。证据：`config.example.yaml:4-130`；`src/core/config.ts:35-92,119-146`。
- **[评价]** 这些 seam 很适合把“一个赛博群友”继续做强，却没有消除 `main.ts` 对模块组合、单 persona、固定存储语义和单 global control plane 的所有权；第三方要创建不同“生命形态”，更像 fork/configure application，而不是安装一个 Cortex/Nerve。

---

## 2. 事件输入与世界接口

### 2.1 入站规范化、过滤与恢复

- **[已实现事实]** 每个 adapter 的入站 message 都被标准化为包含 `chatId`、`userId`、`displayName`、`text`、timestamp、reply、DM/mention、media 等字段的 `type: "nc.message"` payload。证据：Telegram `buildTelegramNcMessage()`：`src/adapter/telegram-adapter.ts:138-180`；Discord：`src/adapter/discord-adapter.ts:69-110`；OneBot：`src/adapter/onebot-adapter.ts:119-165`。
- **[已实现事实]** `NotificationCenter` 是单进程内存 event bus：`push()` 添加 ULID/时间并同步触发 hook；其构造器参数中的 file I/O 已删除。证据：`src/event/notification-center.ts:1-9,45-57,60-94`。因此 `workspace/events.jsonl` 常量并不构成实际 event-log durability。
- **[已实现事实]** main 的 `nc.onPush` 先进行 chat/user filter 与 user gate，随后立即向 `message_log` 写入；仅之后才进入 `GroupSubagent`。证据：`src/main.ts:656-788,790-834`。这保证 CodeAct 的近期上下文不必等待后台 clustering flush。
- **[已实现事实]** 网络中断的恢复是 platform-specific：`PlatformAdapter.fetchMissedMessages()` 明确声明 Telegram userbot、Telegram bot、Discord、OneBot 的不同精度；主入口启动后和 reconnection 后调 `BackfillCoordinator`。证据：`src/adapter/platform-adapter.ts:83-90`、`src/main.ts:625-654,1647-1692`；配置注释给出了能力差异：`config.example.yaml:184-209`。
- **[已实现事实]** backfill message 落盘与聚类但不逐条唤醒；合并后若有 DM/@ 才压入一次 Direct Address attention。证据：`src/main.ts:625-652,738-865`。

### 2.2 对 Athena 的世界接口含义

- **[评价]** CyberGroupmate 的 adapter boundary 证明“世界接口要统一、恢复策略要显式、平台差异要留在 adapter”是有价值的；但它把 platform adapter 直接连接到 Agent application control plane，接口仍是 chat-centric 的 `handleCall(method,args)`。
- **[建议]** Athena 应采纳其**离线补抓水位线、来源时间戳不被接收时间覆盖、platform capability/connection state、outbound action result**等 Nerve 实现模式；但应保持 Athena 的 Capability/Nerve inversion（Cortex 仅依赖 capability，不依赖某 adapter）。Athena 的目标接口方向已有事实基础：`docs/01-design-philosophy.md:149-173`；目前仅 Message capability/Satori 是实现：`docs/06-progress-and-roadmap.md:21-30`。

---

## 3. 上下文与状态模型

### 3.1 状态隔离 key 与生命周期（重点）

| 层级 | key / 载体 | 生命周期与隔离 | 证据与判定 |
| --- | --- | --- | --- |
| 平台会话 | composite `chatId`，如 `telegram:<id>`、`discord:<guild>:<channel>`、`onebot:group:<id>` | adapter 归一化后作为主路由 key；同一 chat 的 Subagent、session file、KV/todo 都绑定它。 | **[已实现事实]** `src/core/chat-id.ts:43-130,188-205`；`src/subagent/subagent-manager.ts:63-89`；`src/memory-v2/memory-v2.ts:618-639`。 |
| Discord 社会群体 | `getGroupModelKey(chatId)` | Guild 的多 channel 合用 `discord:<guild>` GroupModel；DM 和其他平台不变。 | **[已实现事实]** `src/core/chat-id.ts:175-195`。 |
| 单人身份 | composite `userId` | `person_identities` 与 `person_profiles` 以 `user_id` primary key，跨群共享。 | **[已实现事实]** `src/memory-v2/memory-v2.ts:369-395`；入站 user ID 复合化：`src/main.ts:741-744,790-799`。 |
| 人-群关系 | `(user_id, chat_id)` | `person_group_profiles` 的 composite primary key；含 affinity、Dunbar tier、relation、episodes/merged memory。 | **[已实现事实]** `src/memory-v2/memory-v2.ts:397-416`。 |
| 群体状态 | group model `chat_id` | `group_models` 保存 norms、role、feedback、taboo/hot topics、quiet/private flag。 | **[已实现事实]** `src/memory-v2/memory-v2.ts:418-440`。 |
| 短/中期推理 session | `workspace/sessions/<platform>/<chatIdToFileName(chatId)>.json` | `SubagentManager.restoreAll()` 启动扫描恢复；Executor 存 session、execution records、last reply、ContextEngine ledger。实例不做 idle recycling。 | **[已实现事实]** `src/subagent/subagent-manager.ts:48-50,63-67,114-211`；`src/subagent/code-act-executor.ts:1542-1625`。 |
| 全局元状态 | `workspace/global-state.json` | `GlobalState` 每 30s autosave，负责 scheduler/dispatched tasks/meta history；退出时 dispose/save。 | **[已实现事实]** `src/main.ts:579-594,1455-1589,1769-1782`。 |

- **[已实现事实]** SQLite `MemoryStoreV2` 启用 `journal_mode = WAL`、foreign keys，具备 topics、identity/profile、group model、interactions、facts、message log、session digests、FTS5、KV/todo 等表。证据：`src/memory-v2/memory-v2.ts:204-227,340-657`。
- **[已实现事实]** privacy 是纵向 policy：DM/config/runtime marked-sensitive 由 GroupModel + policy 来判定；memory recall、跨 chat dispatch、外发都在 host-call 层检查。证据：`src/memory-v2/memory-v2.ts:234-262`；`src/sandbox/host-call-handler.ts:501-532,1006-1059`；`config.example.yaml:383-400`。
- **[已实现事实]** `GroupSubagent` 是 per-chat 内存容器，含 Observer、TopicRegistry、RecordingPipeline、stickiness、CodeActExecutor；其 `onMessage()` 同时给 observer 和 pipeline。证据：`src/subagent/group-subagent.ts:1-13,57-165`。

### 3.2 Context assembly 与人格

- **[已实现事实]** persona 是 `config.yaml` 的全局 `name` 和 `description`，在 Meta handler 和每个 executor 中被注入 system prompt。证据：`config.example.yaml:160-170`；`src/main.ts:1089-1135,1211-1223`；`src/subagent/code-act-executor.ts:768-797`。
- **[已实现事实]** `ContextEngine` 为 Meta 与 executor 分别维护 ledger，能把 section 按 static/delta/ephemeral 等策略组织；Meta context 组合 global session digests、todos、callbacks、per-entry context/profile 后交给 LLM。证据：`src/main-agent/meta-session-handler.ts:57-115,173-251`；executor 的 per-instance engine：`src/subagent/code-act-executor.ts:429-475,864-892,1017-1020`。README 所称“四类 cache 策略”是**[文档计划/说明]**，其具体实现细节以这些代码为准：`README.md:26-36`。
- **[评价]** “全局人 + 群内关系 + 群体 norm”是 CyberGroupmate 最有辨识度的建模：它避免将同一个用户在不同群完全割裂，也避免把某个群的关系错误泛化给所有群。这比单纯 conversation buffer 更接近长期社会 companion。
- **[风险]** profile、relationship episode、facts 都容纳 LLM 归纳文本；虽然有 source/provenance/visibility 字段（`core_facts`，`src/memory-v2/memory-v2.ts:456-479`）并在 Reflection 构造 evidence，仍未看到在本文调查范围内的 certainty calibration、可撤销关系结论或用户纠错的端到端治理。**[无法确认]** 这类治理是否由未读 Dashboard 路径完整实现。

---

## 4. 核心认知与 LLM 调用

### 4.1 双层 Agent orchestration

- **[已实现事实]** `MainAgentLoop` 用定时 `setTimeout` polling，先 drain CallbackQueue、读取 AttentionAccumulator，再将同 tick 的 chat entries 交给唯一 Meta session handler；对 executor busy 的 chat requeue；Meta quota error 有指数 backoff circuit breaker。证据：`src/main-agent/main-agent-loop.ts:128-175,180-425,654-662`。
- **[已实现事实]** Meta handler 拼 messages，调用 `runMetaSession(... maxTurns, codeTimeout, llmCaller, twoPass docs ...)`，并将新增消息写回 `GlobalState` 的 meta history。证据：`src/main-agent/meta-session-handler.ts:57-115,173-251`。
- **[已实现事实]** executor 对每个 chat 串行 `taskQueue`；`executeWithSandbox()` 将 persona、近期消息、active user profiles、topic、显式 memory、session digests、skills 等组装为 prompt，取得 chat-bound sandbox，调用 `runCodeActSession()`，最多使用 configured max turns。证据：`src/subagent/code-act-executor.ts:438-475,585-683,759-1020`。
- **[已实现事实]** LLM 不是一个模型：routing 区分 meta、session、recording cluster/triage、post-task follow-up、reflection、compact、memory、vision，并支持 fallback profiles。证据：`src/core/config.ts:119-146`；`config.example.yaml:105-130`。

### 4.2 后台认知与社会演化

- **[已实现事实]** RecordingPipeline 对每 chat buffer 使用消息数或 silence trigger，执行 cheap-model topic clustering、summary/triage、TopicRegistry update、Memory V2 write，并能发布 topic signals。证据：`src/pipeline/recording-pipeline.ts:1-15,93-165,227-303`。
- **[已实现事实]** Reflection 按静默/最大间隔/awake-hours 在 main 定时触发 `memory.reflect(chatId,...)`。证据：`src/main.ts:951-1054`；默认配置：`config.example.yaml:274-318`。
- **[已实现事实]** `runReflection()` 先从 `lastReflectedAt` 收集 topics/interactions/profiles，再用 cheap LLM 和自适应缩小 scope；成功时写 global and group-local person profile、affinity/Dunbar tier、relationship episodes、facts、group feedback，并做 episode merge/tier trim。证据：`src/memory-v2/reflection.ts:225-346,357-610`。
- **[评价]** 这是可借鉴的“慢速社会 consolidation”而不是把每轮即时聊天都塞进长期记忆；它对 Athena Future Life 的 memory evolution 有价值。

---

## 5. 行动输出与反馈闭环

### 5.1 一条端到端实际调用链

以下是**[已实现事实]**的 Telegram/Discord/OneBot 共用链（以 Telegram adapter 为具象入口，其他 adapter 同样构造 `nc.message`）：

```text
TelegramAdapter.messageHandler
  → normalize / buildTelegramNcMessage() / NotificationCenter.push("nc.message")
  → main.ts nc.onPush
     → filter + userGate
     → memory.storeMessageBatch(message_log)
     → SubagentManager.getOrCreate(chatId).onMessage()
     → 直接提及/DM：AttentionAccumulator.ingest(L0)
        或 RecordingPipeline topic signal：ingest(L2)
  → MainAgentLoop.tick() / accumulator.flush()
  → createMetaSessionHandler() / runMetaSession()
  → Meta API dispatch 任务到 target chat 的 CodeActExecutor.enqueue()
  → CodeActExecutor.executeWithSandbox()
     → runCodeActSession(LLM 生成并执行 TypeScript)
     → sandbox host-call handler
     → PlatformAdapter.handleCall("telegram.sendText" / "discord.send" / "onebot.send...")
  → Sandbox notify("system.agent_message_sent")
  → main.ts nc.onPush
     → memory.storeMessageBatch + storeInteraction("agent_replied")
     → RecordingPipeline.onMessage(agent message) + PostTaskWindow
  → executor callback → Q5 → MainAgentLoop 下一 tick 记录 dispatch completion / session digest
```

逐段证据：adapter 入口 `src/adapter/telegram-adapter.ts:452-468`；入站存储和 attention `src/main.ts:656-938`；Meta drain/dispatch `src/main-agent/main-agent-loop.ts:191-425`、`src/main-agent/meta-session-handler.ts:57-115`；sandbox execution `src/subagent/code-act-executor.ts:915-999`；outbound adapter invocation `src/sandbox/host-call-handler.ts:501-532`；agent-message feedback `src/main.ts:665-732`；callback `src/subagent/code-act-executor.ts:1040-1089`、`src/main-agent/main-agent-loop.ts:191-257`。

### 5.2 闭环质量与断点

- **[已实现事实]** CodeAct 的 action surface 是 host-call，platform methods 在发出前走 privacy egress、可选 bound-chat restriction、humanized delay，随后 `adapter.handleCall()`。证据：`src/sandbox/host-call-handler.ts:501-532`。
- **[已实现事实]** 一次 session 的 callback 收集 LLM turn transcript、end reason、sent message list、error、duration，写入 GlobalState dispatch record；CallbackQueue 下一 tick 可把 completion digest 回送给发起者/Meta。证据：`src/subagent/code-act-executor.ts:1040-1089`；`src/main-agent/main-agent-loop.ts:191-257`。
- **[已实现事实]** agent 发送后的通知会立即落到 `message_log`、`interactions(type="agent_replied")`，再喂 RecordingPipeline，以避免后续上下文看不见自己说过的话。证据：`src/main.ts:665-732`。
- **[代码推断]** 这至少形成三层内环：**transport attempt result → action record/callback → 自己可见的对话与后续 topic/reflection**。这是比“只打印 LLM text”强得多的 feedback design。
- **[无法确认]** 该闭环在 inspected code 中的外部终点是 `handleCall()` promise 与 sandbox notify；并无可追踪的“平台已投递/被阅读/用户情绪改变/某 relation hypothesis 被验证”的统一 `ActionOutcome` domain record。因此，社会状态的反馈主要是之后的消息、topic 和 Reflection 的间接归纳，而非可靠的因果归因。
- **[建议]** Athena 不应把 CodeAct callback 文本直接当作 Life memory；应先定义可验证的 `EnactmentRecord`（action intent、target Nerve、provider result、idempotency key、observed follow-up），再允许 Cortex/Life 将其中的一部分沉淀为 memory/self-model。

---

## 6. 生命周期、并发与可靠性

### 6.1 生命周期与可靠性事实

- **[已实现事实]** adapter 启动并行且每个有 30 秒超时；即使全 adapter 失败，进程仍保留 Dashboard。证据：`src/main.ts:1610-1645`。
- **[已实现事实]** graceful shutdown 顺序为停止 MainLoop/timers/harness/MCP、停止 adapters、dispose sandboxes、强制 flush RecordingPipeline、dispose subagents/dashboard/metrics、dispose global state/NC，最后 close SQLite。证据：`src/main.ts:1703-1784`。
- **[已实现事实]** `CodeActExecutor` 对**同 chat**用 `taskQueue` 与 `processing` 串行；Main loop 检查 executor busy 后 requeue input，避免同 chat 的并发重复执行。证据：`src/subagent/code-act-executor.ts:438-443,1485-1531`；`src/main-agent/main-agent-loop.ts:326-336`。
- **[已实现事实]** RecordingPipeline 有 `isFlushing`、bounded batch/buffer、失败保护和 silence timers。证据：`src/pipeline/recording-pipeline.ts:70-78,102-138,196-239`。
- **[已实现事实]** Reflection 对每 chat 使用 `reflectionInProgress` Set，避免同 chat 重叠；LLM 超时/限流时缩小回看范围，不成功时不推进水位。证据：`src/main.ts:987-1053`；`src/memory-v2/reflection.ts:285-345`。
- **[已实现事实]** SQLite 使用 WAL；per-chat session 有 JSON snapshot/recovery；GlobalState 30 秒 autosave。证据：`src/memory-v2/memory-v2.ts:204-227`；`src/subagent/code-act-executor.ts:1542-1625`；`src/main.ts:579-590`。

### 6.2 风险

- **[评价]** 单一 `main.ts`（约 1807 行）握有 runtime assembly、policy timing、background behavior、observability 和 teardown，令每项新能力都穿透 central orchestrator；可维护性和多生命扩展的压力将持续累积。证据：`src/main.ts:1-1807`。
- **[评价]** 未受容器级 capability schema 约束的 CodeAct 能力很灵活，但 sandbox host-call 是巨大的 trust boundary：对 privacy、write target、environment、MCP、shell 的 guard 需要持续审计。现有保护是正面事实（`src/sandbox/host-call-handler.ts:501-760,1006-1113`），但这不等同于完整 sandbox security proof。**[无法确认]** 本研究未审计 sandbox OS/process isolation。
- **[评价]** `NotificationCenter` 是 in-memory 且文件持久化已移除（`src/event/notification-center.ts:1-9,45-57`）；崩溃窗口依赖即时 SQLite 写入和平台 backfill 补偿，无法保证所有内部 transition 都持久。对于 social companion 已可实用，但若作为多生命平台的共用 event substrate，需更清晰的 durable boundary。

---

## 7. 扩展性与平台化能力

### 已具备的可扩展点

1. **[已实现事实] PlatformAdapter**：将 Telegram/Discord/OneBot 的 connection、backfill、outbound operations 收敛。证据：`src/adapter/platform-adapter.ts:75-110`。
2. **[已实现事实] CodeAct skills/MCP**：通过 module registry、`.d.ts` progressive disclosure、`workspace/skills/` 和 MCP bridge 拓展执行能力。证据：`README.md:38-47`（文档说明）与代码 `src/subagent/code-act-executor.ts:203-286,980-989`、`src/main.ts:325-347`。
3. **[已实现事实] Model profiles**：多 provider/model route、fallback、pool 支持组件级优化。证据：`src/core/config.ts:35-92,119-146`、`config.example.yaml:4-130`。
4. **[已实现事实] Background harness**：可选将 external Claude Code/Codex/Copilot harness 连接其 MCP API，以 cron/idle 作“dreaming”。证据：`src/main.ts:1326-1417`、`config.example.yaml:531-545`。

### 平台化的缺口

- **[代码推断]** 以上是“单 Agent application 的 extension points”，不是 Athena 所需“多个 Life 各自选择 Cortex，多个 Nerve 可并存并由 Capability 反转依赖”的平台契约；例如 `SubagentManager` 的 key 是 chat，且 `main()` 读取一份 global persona/config。证据：`src/subagent/subagent-manager.ts:52-90`、`src/main.ts:1089-1156,1211-1223`。
- **[评价]** 若把 CyberGroupmate 的 Meta/Subagent hierarchy 原样带入 Athena，会让“群/聊天会话”重新成为一级本体，吞没 Life 作为跨 Cortex/Nerve 常量的抽象。

---

## 8. 工程质量与风险

### 优点

- **[已实现事实]** 明确的 data durability：SQLite/WAL、FTS5、session snapshots、GlobalState persistence、adapter reconnect/backfill。证据：`src/memory-v2/memory-v2.ts:204-227,340-657`；`src/subagent/subagent-manager.ts:114-211`；`src/main.ts:1647-1692`。
- **[已实现事实]** 可观测性在代码中有 Dashboard/metrics wiring，LLM/CodeAct 还携带 Context Manifest 和 callback artifact。证据：`src/main.ts:1262-1324,1420-1446`；`src/main-agent/meta-session-handler.ts:75-95`；`src/subagent/code-act-executor.ts:1022-1089`。
- **[已实现事实]** 多层成本与可靠性控制：quiet mode、backfill 不逐条唤醒、RecordingPipeline 批限、profile fallback、Meta circuit breaker、Reflection scope shrink。证据：`src/main.ts:821-865`；`src/pipeline/recording-pipeline.ts:70-78,227-303`；`src/main-agent/main-agent-loop.ts:147-175`；`src/memory-v2/reflection.ts:285-345`。

### 风险和限制

- **[已实现事实]** 依赖面很宽：`package.json` 包含 platform SDK、SQLite、MCP、OpenAI/Google、shell PTY、web server、vision 等。证据：`package.json:22-43`。**[评价]** 这对一体化产品合理，却增大安全补丁、部署与 extension compatibility 的耦合面。
- **[评价]** persona 可通过 config 改，却没有独立的 self-model ownership/版本/迁移边界；其“人格演化”主要落在人、群、relationship memory，而非 Agent 自身状态。`GroupModel.agentRole/recentFeedback` 是群情境上的 agent behavior hint，不是一个跨世界 Life self-model。证据：`src/memory-v2/memory-v2.ts:418-440`；`src/memory-v2/reflection.ts:540-586`。
- **[无法确认]** 未运行项目，无法确认配置示例所述 Dashboard 热重载、外部 harness 或各平台 backfill 在给定版本凭证下可用；本报告不以 README 自述替代运行验证。

---

## 9. 与 Athena Harness 的逐项比较

### 9.1 组织原则、抽象边界、运行时模型对照

| 维度 | CyberGroupmate | Athena Harness（当前） | 判断 |
| --- | --- | --- | --- |
| 第一性抽象 | chat-bound Subagent + global Meta + Sandbox。 | Life（identity）/ Cortex（survival strategy）/ Nerve（world connection）。 | **[评价]** Athena 的本体边界更适合“多种数字生命”；CyberGroupmate 的 per-chat 边界更适合群聊 companion。 |
| 事件输入 | adapters → in-memory NC → app orchestrator。 | Nerve/Capability push Cordis events；Cortex 自定 buffer/rhythm。 | **[已实现事实]** Cyber 已有完备 application flow；Athena 有更一般化方向，见 `docs/01-design-philosophy.md:177-228`。 |
| 多实体隔离 | state mostly keyed by chat/user; one global persona/control plane。 | group `isolate: {life,cortex,message,satori}`，one Cortex per Life。 | **[已实现事实]** Athena 的 service isolation 已落地：`docs/02-architecture.md:215-289`；Cyber 无等价 multi-Life container。 |
| 认知 | Meta-CodeAct + per-chat CodeAct; background cluster/reflection。 | cortex-chat 仅 echo；AIService/provider registry 已有。 | **[已实现事实]** Cyber 当前能力明显更完整；Athena roadmap 明确未完成 cognition：`docs/06-progress-and-roadmap.md:231-254`。 |
| Memory | SQLite social memory、reflection、global/local person profile、facts。 | Life 的 `MemoryStub` in-memory，持久化未做。 | **[已实现事实]** 见 Cyber `src/memory-v2/memory-v2.ts:204-227`；Athena `plugins/life/src/life.ts:4-33`。 |
| 行动 | Sandbox CodeAct → host-call → adapter；callback + outbound re-ingestion。 | `ctx.message.createMessage()` 可用，当前 chat Cortex echo。 | **[已实现事实]** Athena output seam 正确但 tool/action framework 未实现。 |
| 主动性 | attention signals、reflection, reminders/cron、proactive idle/dreaming。 | target has Chat/World/Interlude Cortex; latter two未实现。 | **[已实现事实]** Cyber 已积累机制；Athena 的多形态设计仍是 roadmap。 |
| 扩展 | adapter interface、skills/MCP/config；central bootstrap owns composition。 | Cordis managed plugin tree、Capability/Cortex/Nerve package roles。 | **[评价]** Athena 更适合 ecosystem-level composition；Cyber 更适合 product-level feature delivery。 |

### 9.2 Athena 已明显领先

1. **[已实现事实] 多 Life 结构性隔离。** Athena 明确 isolate `life/cortex/message/satori`，并用 event scope filtering 防止跨 Life 串台；Cyber 的 chat key 可隔离 session/DB rows，但没有“一个进程装载多个独立人格、可各自换 Cortex/Nerve”的 first-class boundary。证据：Athena `docs/02-architecture.md:215-289`、`docs/01-design-philosophy.md:232-296`；Cyber `src/subagent/subagent-manager.ts:52-90`。
2. **[已实现事实] 依赖倒置的世界抽象。** Athena Cortex 依赖 capability、Nerve 实现 capability，刻意不让 IM 成为 framework identity。证据：`docs/01-design-philosophy.md:149-173`、`docs/02-architecture.md:142-149`。Cyber 的 `PlatformAdapter` 是可取 seam，但其 actions/inputs 仍以 messaging app 结构组织。
3. **[已实现事实] Cortex 是可替换的完整生存策略而非 router pipeline。** Athena 将 rhythm/integration/cognition/enactment/continuation 保持同一可替换单元。证据：`docs/01-design-philosophy.md:66-120`。这避免将 Cyber 的 Meta/subagent hierarchy误定为所有 digital life 的唯一认知形态。

### 9.3 Athena 设计正确但尚未实现

1. **[已实现事实] Life durable memory / persona files / self-model。** Athena 文档与 roadmap 将它们列为 Phase 3，当前 `MemoryStub` 和 inline-only persona 证明尚未实现。证据：`plugins/life/src/life.ts:4-52`；`docs/06-progress-and-roadmap.md:258-290`。
2. **[已实现事实] Reactive Chat 的 willingness、aggregation、per-channel serialization、LLM tool-loop、wait/action。** 这些在 roadmap 明确列出；当前 `CortexChat` 只是 message→echo。证据：`plugins/cortex-chat/src/index.ts:15-44`；`docs/06-progress-and-roadmap.md:231-254`。
3. **[已实现事实] Continuous World / Narrative Interlude。** Athena 文档给出三种 Cortex 但 code 尚无后两者。证据：`docs/00-overview.md:31-37`；`docs/06-progress-and-roadmap.md:55-68,294-300`。
4. **[已实现事实] Tools registry、Hooks 与 execution records。** Athena roadmap 将 `ctx.tools` 和 hook protocol 作为未开始，且 execution record 尚未设计。证据：`docs/06-progress-and-roadmap.md:55-68,177-229`。

### 9.4 Athena 当前明显不足

1. **[评价] 关系持续性实现缺口。** Cyber 已有 global identity/profile、per-group relationship profile、Dunbar/affinity、episodes/reflection feedback；Athena Life 只有 in-memory map，无法跨进程保持 persona/memory，更无社会关系 vocabulary。事实差异：Cyber `src/memory-v2/memory-v2.ts:369-479`、`src/memory-v2/reflection.ts:357-610`；Athena `plugins/life/src/life.ts:4-33`。
2. **[评价] 真实闭环/可观测性缺口。** Cyber 有 sent-message collection、callback/Q5、session digest、Dashboard/metrics wiring；Athena 没有 LLM cognition、tools 或 Execution Record。证据：Cyber `src/subagent/code-act-executor.ts:915-1089`、`src/main-agent/main-agent-loop.ts:191-257`；Athena `docs/06-progress-and-roadmap.md:61-68,231-254`。
3. **[评价] 主动行为已落地程度缺口。** Cyber 的 cron/reminder/reflection/idle 明确运行；Athena World/Interlude 未实现。证据：Cyber `src/main.ts:951-1054,1455-1608`；Athena `docs/06-progress-and-roadmap.md:294-300`。

### 9.5 对方值得借鉴

1. **[建议] 借鉴“社会 memory 分层”，但把 owner 放在 Athena Life。** 引入明确的 `PersonIdentity`（跨世界/adapter stable identity）、`RelationshipMemory`（Life×Person×social context）、`SocialContext`（群/频道的 norms/role/topics），并区分 global/person relationship/context facts；每项需要 source, observedAt, visibility, confidence/revision。依据：Cyber tables `src/memory-v2/memory-v2.ts:369-479`。
2. **[建议] 借鉴 Reflection 的慢路径。** 将 consolidation 设计为可安装的 Life memory plugin，收集真实 interaction/action outcome，再周期性写关系和 self-model；使用 checkpoint，LLM failure 不推进水位，具备 bounded retry。依据：`src/memory-v2/reflection.ts:225-345,540-610`。
3. **[建议] 借鉴“自身输出必须回灌”。** `MessageService` 或通用 Capability 应产出 normalized outbound observation，Cortex/Life 使用同一 event/memory path 收录“我做了什么”；同时保存 adapter result 而非仅 text。依据：Cyber `src/main.ts:665-732`。
4. **[建议] 借鉴 adapter reconnect/backfill 的证据化差异模型。** Nerve capability declaration 应含 history/backfill/ordering/reliability traits，不把 Telegram bot 和 userbot/Discord/OneBot 的能力假设成相同。依据：`src/adapter/platform-adapter.ts:83-90`。
5. **[建议] 借鉴 per-channel/work queue 的具体并发策略，但归属 Cortex。** Cyber 的 per-chat executor queue + busy requeue 说明消息生命周期可行；Athena 不应在框架层硬造通用 inbox，应由 Reactive Cortex 做 per-conversation serial execution。依据：Cyber `src/subagent/code-act-executor.ts:438-443,1485-1531`；Athena push-based decision `docs/01-design-philosophy.md:177-228`。

### 9.6 不应照搬

1. **[建议] 不照搬 global Meta + chat-bound Subagent 为 Athena mandatory hierarchy。** 这把 chat/group 升格为 identity owner，无法自然覆盖 Minecraft、Live2D、physical body、non-social continuous world；Athena 需要由某个 Cortex 自由选择是否采用 global coordination。依据：Athena Nerve 的多介质定位 `docs/01-design-philosophy.md:124-173`；Cyber chat binding `src/subagent/subagent-manager.ts:48-89`。
2. **[建议] 不照搬 `method: string, args: unknown[]` 作为 Athena tools 公共契约。** 它适合 CodeAct 逃生舱，却牺牲类型化、scope-aware discovery、guard/hook/execution record。Athena 应推进 roadmap 中 `ctx.tools.register/available/execute` 的 typed boundary。证据：Cyber `src/sandbox/host-call-handler.ts:501-532`；Athena `docs/06-progress-and-roadmap.md:193-198`。
3. **[建议] 不照搬全局 singleton persona/config。** Athena Life 必须可被同进程内多个实例持有，persona/memory/self-model 要与 Life 生命周期绑定，不应由 application root 给所有 Cortex 注入同一份 config persona。证据：Cyber `src/main.ts:1089-1135,1211-1219`；Athena `docs/01-design-philosophy.md:35-63`。
4. **[建议] 不照搬将 reflection 直接等同于“人格演化”。** 对群与人的总结是外部社会模型；Athena 的 self-model 应单独表意、有 provenance、允许 policy/consent/可撤销处理，不能因群聊 LLM summary 就任意改写“我是谁”。

### 9.7 可能误导的表面相似点

| 表面相似 | 为什么不等价 |
| --- | --- |
| Cyber 的 per-chat `GroupSubagent` 与 Athena 的 Life group 都有独立状态。 | Cyber 的 owner 是一个 chat route；Athena 的 owner 是一个跨 Nerve/Cortex 保持身份连续的 Life。`chatId` 不是 Life ID。 |
| Cyber 的 global Meta 看似 Athena Cortex。 | Meta 是 central cross-group dispatcher；Cortex 是一个 Life 的完整生存策略，可能 reactive、continuous 或 narrative，未必有 global Meta。 |
| Cyber platform adapter 与 Athena Nerve。 | adapter 是平台 SDK bridge；Nerve 是一条有 presence、sense 和 act 的 Life-world 双向通道，并通过 Capability 反转依赖。 |
| Cyber `persona` 与 Athena Life persona。 | Cyber persona 是 application config 注入 prompt；Athena persona 是 Life identity 的组成，但当前实现仍待 durable lifecycle。 |
| Cyber reflection 与 Athena self-model。 | Cyber reflection主要更新人、群、事实和行为提示；Athena self-model 是实体自身可演化状态，二者只能部分重叠。 |

---

## 对 Athena 开发方向与优先级的影响

### P0：先建立可持久的 Life 关系/行动事实底座（不是先复制 Agent hierarchy）

- **[建议]** 实现 `MemoryProvider` 的 SQLite backend，至少支持 identity-scoped memory、provenance、timestamp、visibility、confidence、action/outcome record，并让它由 per-Life lifecycle 持有；替换 `MemoryStub`。这是 Athena 的身份连续性前提，也是任何关系/自我演化的安全地基。
- **依据**：Athena 当前只有 `MemoryStub`：`plugins/life/src/life.ts:4-33`；Phase 3 已确认 SQLite persistence：`docs/06-progress-and-roadmap.md:258-290`；Cyber 的可取 schema 包含 source/visibility 与 social split：`src/memory-v2/memory-v2.ts:369-479`。
- **应暂缓**：暂不把 Cyber 的所有 `topics/person_profiles/group_models` 表作为 Athena core schema 固化。它们是群聊 companion 的 domain plugin 模型，不是所有 digital life 的必备属性。

### P0：完成一个真实 Reactive Cortex 的受控闭环

- **[建议]** 依 Athena 已确认路线实现 willingness → bounded aggregation → per-conversation serialization → `generateText` tool-loop/failover → typed Layer 2 send/wait → `MessageService` enactment，并为每次 enactment 产出 execution/outcome record；成功输出再投递 normalized outbound observation。
- **依据**：Athena 的精确待办：`docs/06-progress-and-roadmap.md:231-254`；Cyber 已展示 output self-ingestion/callback 的收益：`src/main.ts:665-732`、`src/subagent/code-act-executor.ts:1040-1089`。
- **应暂缓**：不要先引入 arbitrary TypeScript CodeAct/Shell 作为默认 cognition；先以 typed tools、scope、guard 和 outcome event 收紧攻击面。

### P1：实现社会关系为可选 Life extension，并用慢速 consolidation 更新

- **[建议]** 定义可选 `plugin-social-memory`：`PersonIdentity`、`RelationshipMemory`、`SocialContext`、`InteractionRecord`；由 lifecycle-managed reflection/consolidation Cortex helper 消费已观察到的 interaction/outcome，不在每个即时 turn 直接修改长期关系。采用 Cyber 的“global person + local group relation”思想，但让 Nerve 提供 social context ID，不硬编码 chatId。
- **依据**：Cyber schema：`src/memory-v2/memory-v2.ts:369-453`；安全 checkpoint/resilient Reflection：`src/memory-v2/reflection.ts:225-345`；Athena Life 目标已有 memory/self-model：`docs/01-design-philosophy.md:35-63`。
- **应暂缓**：Dunbar tier、群角色、taboo topic 不要写入 Athena core protocol；将其留给 IM/social Nerve companion plugin。

### P1：把 Nerve 的可靠性能力和行动结果变成协议

- **[建议]** 在 Hook/Capability protocol 设计中增加归一化 `InboundObservation`、`OutboundAction`、`ActionResult`、`BackfillWatermark` 和 connection/reliability capability；Cortex 能根据 Nerve 证实的 delivery/capability facts 决定 continuation。
- **依据**：Cyber adapter contract/backfill capabilities：`src/adapter/platform-adapter.ts:75-110`；Athena 当前 Hook Protocol 与 execution record 尚未开始：`docs/06-progress-and-roadmap.md:59-68,210-229`。

### P2：以可选 Cortex 实现跨世界协调与主动性

- **[建议]** 当 Life persistence 和 Reactive Cortex 可靠后，实现 `cortex-world` 的 heartbeat/mailbox，并将 cron/reminder/idle 设计为可替换 rhythm source，而不是 root singleton scheduler；需要跨 Life/群协调时可做一个明确的 Coordinator Cortex 或 plugin，而非改变 Life 原语。
- **依据**：Cyber scheduler/idle 已显示多 trigger practical value：`src/main.ts:1455-1608`、`src/main-agent/main-agent-loop.ts:264-288`；Athena Phase 4 的目标是 Continuous World：`docs/06-progress-and-roadmap.md:294-300`。
- **应暂缓**：外部 coding harness “dreaming” integration。它适合 Cyber 的 application，但在 Athena 还未建立 typed tools、durable identity、Nerve outcomes 前会扩大不可控能力面。

## 最终判断

**[评价]** CyberGroupmate 不应被误判为“可组合数字生命框架的直接模板”：它已经是工程成熟度较高的群聊社会 Agent application，强项在真实 IM 接入、chat/user/group social memory、后台 consolidation、CodeAct action 与行动回灌。Athena 的正确演进不是复刻其 global Meta/subagent 架构，而是把其中经过实践验证的**关系状态分层、慢速反思、输出回灌、平台可靠性事实、per-conversation 并发控制与可观测 action record**分别迁移为可安装、可隔离、由 Life/Cortex/Nerve ownership 清楚的能力。这样 Athena 才能同时容纳一个群聊 companion、一个连续世界主体和一个叙事角色，而不再次退化为单一消息应用。
