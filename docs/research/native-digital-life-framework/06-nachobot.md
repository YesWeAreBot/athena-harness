# NachoBot：从跨平台聊天 Agent 到数字生命平台的架构研究

> **研究范围与证据边界**：本报告直接检查 `/home/workspace/references/NachoBot` 的 Python core、`ncnk_message` wire protocol、`NachoBot-Koishi-Adapter` 的 OneBot 实现，以及 Athena Harness 当前代码与正式文档。未执行启动、build、test、lint 或 formatter。故所有「可运行性」均标为**无法确认**，不以 README 推断。行号为检查时文件的实际行号。
>
> **状态图例**：**[已实现事实]** 源码直接证明；**[文档计划]** Athena 正式文档声明但尚未实现；**[代码推断]** 由多个已实现点逻辑推出；**[无法确认]** 可得代码不足以断定。

## 关键结论与证据索引

| 结论                                                                                                                                | 状态             | 关键证据                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NachoBot 是一个单进程、单份 global configuration 与 singleton runtime 驱动的多平台聊天 Agent，不是可实例化的多 Life runtime         | **[代码推断]**   | `src/main.py:35-39,55-138`；`src/chat/message_receive/chat_stream.py:118-142`；`src/config/config.py` 的 `global_config` 被全链路导入                                        |
| 多平台输入通过 `BaseMessageInfo` 统一到同一个 `chat_bot.message_process`                                                            | **[已实现事实]** | `NachoBot-Koishi-Adapter/adapter.py:145-248`；`ncnk_message/message_base.py:219-337`；`src/main.py:136-138`；`src/chat/message_receive/bot.py:456-574`                       |
| 「同一意识」在 runtime 与人格配置层共享；短期上下文严格按 `platform + group/user` stream 隔离，跨 stream 长期 Memory 可由配置放开   | **[代码推断]**   | 单例 `ChatBot`/`global_config`；`chat_stream.py:177-200`；`A_memorix/_compat.py:123-212`                                                                                     |
| 主回复为 planner（JSON action）与 replyer（文本）两段 LLM pipeline，而不是统一 tool-loop                                            | **[已实现事实]** | `planner.py:727-793`；`heartFC_chat.py:1126-1311,1754-2003`；`replyer/group_generator.py:990-1328,1481-1497`                                                                 |
| 平台回执仅在 adapter WebSocket 的 OneBot `status/retcode/echo` 中记录；通用发送链没有把送达/实际消息 ID 可靠地回流给 Cortex/Planner | **[已实现事实]** | `adapter.py:121-143,305-340`；`uni_message_sender.py:72-86,175-194`；`heartFC_chat.py:1547-1587`                                                                             |
| Athena 当前实现已具备 per-Life event ownership 与 one-Cortex-per-Life；但 LLM、Tool Registry、持久 Memory、真实多平台运行仍未完成   | **[已实现事实]** | `plugins/capability-message/src/index.ts:41-105`；`plugins/life/src/life.ts:5-52`；`plugins/cortex-chat/src/index.ts:15-44`；`docs/06-progress-and-roadmap.md:55-68,231-289` |

---

# 一、项目定位与核心抽象

## 1.1 NachoBot 的实际定位

**[已实现事实]** NachoBot core 的 package 描述是「基于大语言模型的可交互智能体」，依赖 FastAPI、WebSockets、OpenAI/Gemini SDK、FAISS、Peewee、MCP 等（`NachoBot/pyproject.toml:1-59`）。启动的 `MainSystem` 创建一个全局 `MessageServer` 与全局 HTTP `Server`（`src/main.py:35-39`），初始化单一插件管理器、全局 chat manager、memory 子系统、mood manager 与定时任务（`src/main.py:55-152`）。

**[代码推断]** 它的核心抽象是：

- **统一消息协议**：`MessageBase(BaseMessageInfo, Seg)`；
- **ChatStream**：以单个平台单群/单私聊划分的运行时对话流；
- **HeartFlow/Planner/Replyer**：每个 stream 的决策及执行 loop；
- **全局 bot persona/config、插件与模型池**：由 process-global singleton 共享。

这是一种「**共享 bot identity + platform/session-isolated conversation runtime + 可选跨 stream memory**」的混合模型，不是每个 adapter/account 都可创建独立 Agent/Life 的平台。

## 1.2 与 Athena 的核心抽象比较

Athena 的正式模型把 **Life（identity / persona / memory / self-model）**、**Cortex（完整生存策略）**、**Nerve（世界双向通路）**作为不可拆的三原语（`docs/00-overview.md:9-29`；`docs/01-design-philosophy.md:35-47,66-80,124-173`）。当前代码中 `Life.bind()` 强制一个 Life 只绑定一个 Cortex（`plugins/life/src/life.ts:21-46`），`Cortex` 的 init 自动绑定/释放（`packages/protocol/src/cortex.ts:3-13`）。

| 比较项     | NachoBot                                            | Athena                                                 |
| ---------- | --------------------------------------------------- | ------------------------------------------------------ |
| 核心单位   | ChatStream 与 global bot                            | Life / Cortex / Nerve                                  |
| 身份所有权 | 实际由 `global_config` + singleton 间接持有         | `Life` Service 显式持有 persona、memory                |
| 运行策略   | HeartFlow 作为内置、固定主 loop                     | Cortex 是可整体替换策略                                |
| 世界接入   | adapter + shared `ncnk_message` protocol            | Nerve 实现 Capability；Cortex 不依赖具体 Nerve         |
| 多实体     | **[代码推断]** 无 clear per-Agent instance boundary | **[已实现事实]** Cordis group isolate 的 per-Life 边界 |

---

# 二、事件输入与世界接口

## 2.1 Adapter normalization

**[已实现事实]** Koishi/OneBot adapter 在 `KoishiOneBotAdapter._receive_onebot()` 读取 WebSocket JSON，只把 `post_type == "message"` 导向 `handle_onebot_message()`；OneBot action response 则只写 success/failure log（`NachoBot-Koishi-Adapter/adapter.py:121-143`）。

`handle_onebot_message()` 做如下 normalization：

1. 排除 bot 自己发的事件（`adapter.py:145-150`），提取 `message_type`、user/group id 并套 whitelist/blacklist（`152-167`）。
2. `parse_onebot_message()` 将原始 segment 规范到 `Seg[]`；图片可附加 `visual_policy`（`169-181`；解析函数见 `message_parser.py:9-137`）。
3. 把 platform、message id/time、`UserInfo`、可选 `GroupInfo`、`FormatInfo` 与 `additional_config` 组装成 `BaseMessageInfo`，构造 `MessageBase`（`186-224`）。
4. 依据 `platform` 的 Router target 通过 WebSocket 发送 core（`241-248`）。

协议的 `BaseMessageInfo` 不只含 `platform/message_id/time`，还容纳旧式 `group_info/user_info`、新式 `sender_info/receiver_info`、format/template/additional config（`NachoBot/ncnk_message/message_base.py:219-293`）；但 core 下面的核心 ChatStream 与 message storage 仍主要读取 `user_info/group_info`（`bot.py:482-514`；`storage.py:92-127`）。这是协议演进的兼容层，不是抽象完全收敛的证据。

## 2.2 完整跨模块调用链（OneBot → 生成 → OneBot）

以下是已能由源码逐节点证实的一条完整时序：

1. **OneBot receiver**：`KoishiOneBotAdapter._receive_onebot` 接收 JSON，`handle_onebot_message` 过滤、normalize 为 `MessageBase`（`NachoBot-Koishi-Adapter/adapter.py:121-248`）。
2. **adapter→core transport**：`_send_to_nachobot` 使用 `Router` platform client 的 `send_message(payload)`（`adapter.py:241-248`）；路由配置以 `config.platform` 指向 core `/ws`（`adapter.py:60-69`）。
3. **core ingress**：`MainSystem._init_components` 将全局 `chat_bot.message_process` 注册给 `MessageServer`（`NachoBot/src/main.py:136-138`）。`MessageServer` 的接收/handler dispatch 实现在依赖内，本次未继续展开，故该协议内部网络反序列化为**[无法确认]**；注册关系与 adapter payload 均为事实。
4. **core event normalization/stream selection**：`ChatBot.message_process` 再将 group/user id string 化，`MessageRecv(message_data)` 反序列化，触发插件 pre-hook，登记消息并 `get_or_create_stream(platform,user_info,group_info)`，随后处理 Seg 内容（`src/chat/message_receive/bot.py:456-574`）。
5. **conversation key**：`ChatManager._generate_stream_id` 用 `platform + group_id`（群）或 `platform + user_id + "private"`（私聊）计算 MD5；因此同一 external id 在不同平台必然是不同 stream（`chat_stream.py:177-200`）。`get_or_create_stream` 对创建有 `_stream_registry_lock` 与共享 task，但返回 deep copy 且将最新入站消息置为 context（`202-220,235-318`）。
6. **持久化与调度**：`HeartFCMessageReceiver.process_message` 先持久化 message，再为该 stream（或 Focus 指定 active stream）创建/唤醒 HeartFlow chat，并异步更新 mood 和登记 Person（`heartflow_message_processor.py:61-146`）。Message database row 含 `chat_id=stream_id`、用户、群、平台与正文（`storage.py:34-147`）。
7. **上下文与 planner**：`HeartFChatting` 按 stream 拉取有上限的历史；插入 promise cache、long-term memory、person profile；再构建 planner prompt，让 planner LLM 返回 JSON actions（`heartFC_chat.py:979-1087,1126-1223`；`planner.py:727-793`）。
8. **action dispatch**：按 `parallel_action` 将 action 分为 serial/parallel，reply 强制置于 serial 前列，其余 parallel action 用 `asyncio.gather` 同时执行（`heartFC_chat.py:1263-1311`）。普通 action 由 `ActionManager.create_action` 从 global `component_registry` 获得 class 并实例化，`execute()` 在 Focus effect permit 中调用（`action_manager.py:31-98`；`heartFC_chat.py:1483-1545`）。
9. **reply LLM**：reply action 调 `generator_api.generate_reply`；group replyer 并行准备 relation/memory/tool/knowledge/personality/mid-term-memory，格式化一个字符串 prompt，调用 `express_model.generate_response_async`（`heartFC_chat.py:1877-1945`；`group_generator.py:990-1328,1481-1497`）。
10. **platform action**：`_send_response` 聚合/分段后调用 `send_api`；最终 `UniversalMessageSender` 调 `get_global_api().send_message(message)`，随后才 storage（`heartFC_chat.py:1547-1752`；`uni_message_sender.py:72-86,95-194`）。`MessageServer.send_message` 以 outgoing `message_info.platform` 选连接（`ncnk_message/api.py:233-237`）。adapter `handle_from_nachobot` 把 Seg 转 OneBot，使用 outgoing message 中的 group/user 选目标，`_onebot_send("send_msg")` 在 lock 下发送并有 5 秒发送超时（`adapter.py:250-340`）。

## 2.3 对世界接口的评价

**优势（已实现事实）**：wire protocol 可以保存 raw identity、segment、format 和 adapter `additional_config`；`runtime_capabilities` 的文档字符串明确要求 core 按 capability 而非 platform name 推断（`src/chat/runtime_capabilities.py:1-5`）。

**风险（代码推断）**：platform-specific policy 通过 untyped `additional_config` 渗入多个 core 分支（如 visual、tools、planner bypass）；它是可行的 transport envelope，却不是稳定的 Capability contract。Athena 应采纳「显式 capability」而非借鉴任意 dict 透传。

---

# 三、上下文与状态模型

## 3.1 session、platform、account、user/group identity

**[已实现事实]** `ChatStream` 明确保存 `stream_id/platform/user_info/group_info` 和最新 `ChatMessageContext`（`chat_stream.py:63-115`）。群 context key 忽略 user；私聊 key 由 user 构成（`177-200`）。消息仍保存 sender 的 user info 与 chat info（`storage.py:92-140`）。

**[代码推断]** 这提供了 **per-platform/per-conversation history isolation**，却没有 account id 写入 key。若一个平台同时存在两个 bot account，或将 identity 同步到两个 adapter，现有 key 不能区分 account ownership；实际 adapter 的 `self_id` 只被拿来排除自消息（`adapter.py:145-150`），未进入 ChatStream identity。

## 3.2 多平台是否进入同一核心主体？明确结论

### 结论

**结论：是，多个平台事件进入同一个 NachoBot core process 与一组 shared global bot services；但不会进入同一个短期 conversation context。它是「共享身份（实现上是 global config），会话/平台隔离」模型，而非真正显式、可多实例的统一 Life。置信度：高。**

### 支持证据链

1. 所有 adapter 都应发送同一 `MessageBase` wire shape，core 只注册一个 `chat_bot.message_process` handler（`src/main.py:136-138`）。
2. `ChatBot` 在模块底部构造唯一 `chat_bot = ChatBot()`（`src/chat/message_receive/bot.py:581-582`）；`ChatManager` 也以 singleton `__new__` 实现（`chat_stream.py:118-142`）。
3. Stream key 用 `platform` 分隔（`chat_stream.py:177-200`），故不同平台 message 不共享当前 stream 的 message history。
4. identity / reply behavior 在 replyer 从 process-wide `global_config.bot` 和 `global_config.personality` 读取（例如 `group_generator.py:1021-1023,1264-1321`；模板首位 `{identity}` 在 `replyer_prompt.py:11-28`）。
5. A_Memorix 的 `get_shared_memory_session_ids(chat_id)` 可按 cross-chat memory access 解析其他现有 stream 的 read/write permission（`src/A_memorix/_compat.py:123-212`）；这说明跨 session memory 是另设策略而非天然隔离。

### 反证与边界

- **反证 1（不是一个完全无隔离的 context）**：不同 `platform + group/user` 生成不同 `stream_id`，并以 `chat_id=stream_id` 存 history（`chat_stream.py:177-200`; `storage.py:103-106`）。
- **反证 2（不是「统一 Life」的强语义证明）**：代码没有 `Life`/`AgentInstance`/account-to-agent registry；全局 persona/config 只证明共享 process configuration，不能证明记忆、self-model、权限与生命周期组成可独立恢复的实体。
- **反证 3（跨 stream memory并非必然共享）**：`get_shared_memory_session_ids` 受配置访问规则筛选（`A_memorix/_compat.py:156-212`）。具体默认配置及 production 开关本次未验证，故默认共享范围为**[无法确认]**。

## 3.3 Memory：读、写、截断与恢复

**[已实现事实]** 入站 message 在 HeartFlow 前写 SQL/Peewee Message storage（`heartflow_message_processor.py:83-104`；`storage.py:34-147`）。reply message 在成功发送之后存储（`uni_message_sender.py:175-194`）。ChatStream 启动时会加载数据库已有 stream（`chat_stream.py:260-318`）。长期 memory service 在 startup 启动失败时只 warning、系统继续运行（`main.py:59-71`）。

**[已实现事实]** replyer 以 `context_size` 取近期历史；planner 取约 60% 上限并 `truncate=True`，replyer 则拆分 core/background history（`heartFC_chat.py:988-1015`; `group_generator.py:1056-1070,1251-1258`）。中期 memory 和 long-term retrieval 会分别注入（`group_generator.py:1123-1151`; `heartFC_chat.py:1063-1087`）。

**[无法确认]** `build_memory_retrieval_prompt()` 内部的召回排序、token budget 与 A_Memorix 物理持久化完整时机，需要展开其所有后端；仅凭本次路径不能声称所有 Memory 均跨重启可靠。

---

# 四、核心认知与 LLM 调用

## 4.1 System Prompt、Persona、history、Memory、当前事件、tool result 的组合顺序

**[已实现事实]** 主 chat reply 是拼成**一个 text prompt**后，以 user-like 单条 message 进入 `LLMRequest.generate_response_async()`：`MessageBuilder.add_text_content(prompt)`（`src/llm_models/utils_model.py:179-234`），OpenAI client 会把该 message list 转换并调用 `chat.completions.create`（`model_client/openai_client.py:477-545`）。它不是 provider API 层面的 System-role persona + independent history message list。

群聊 normal reply 的可观察拼接顺序为：

1. `{identity}`（来自 `build_personality_prompt()`）与 `{focus_handoff_block}`；
2. 回复行为指令、style；
3. background history；
4. core history；
5. current time；
6. 当前 target event 与 keyword reaction；
7. knowledge → long memory retrieval → mid-term memory → relation → tool info → extra info；
8. expression habits；
9. moderation/guardrail。

此字面顺序由 `replyer_prompt.py:11-28` 定义；变量来源、并发构建和 format 由 `group_generator.py:1015-1328` 证明。私聊 template 同样 identity 在前，但采用 `{dialogue_prompt}`（`replyer_prompt.py:53-70`）。

**重要限制 [代码推断]**：多个 prompt fragment 是并发取得而非并发拼接（`group_generator.py:1123-1151`）；最终顺序是 template 固定顺序。若 fragment 含 user-originated text，`guard_user_content` 覆盖 target/history，却不能从该局部代码证明对 retrieval/tool result 也逐项隔离，故注入边界的完整性为**[无法确认]**。

## 4.2 Planner、structured actions 与 tool calls

**[已实现事实]** Planner 向 LLM 传 action descriptions，拿文本后从 Markdown/JSON 中抽取多个 JSON object，解析为 `ActionPlannerInfo`（`planner.py:699-725,727-793`）。所以业务行动主要是 **model-generated structured JSON action**，不是 provider-native tool call。

**[已实现事实]** `LLMRequest.generate_response_async` 虽可接受 native `tools` 且返回 `ToolCall[]`（`utils_model.py:179-234`），但主 replyer 的 `llm_generate_content` 没有传 tools，仅把 `tool_calls` 存在 response data（`group_generator.py:1481-1497`; `group_generator.py:261-295`）。由此不能把 replyer 的 native `tool_calls` 当作已经被执行的工具循环。

**[已实现事实]** 一个独立的 memory ReAct agent 才是标准 native tool-loop：首轮创建 `System` message + conversation messages，调用 `generate_with_model_with_tools`，将 assistant tool calls append，随后处理 observations（`memory_retrieval.py:319-410`）。这是 Memory subsystem 的辅助认知，不等价于主聊天行动 pipeline。

## 4.3 LLM 可靠性

**[已实现事实]** `LLMRequest` 按 usage/penalty 选 model；单 model 对 network/empty、429/5xx 依 provider policy 重试，413 时压缩 messages；耗尽后切换后续 model（`utils_model.py:263-476`）。replyer 捕获失败并返回 false，planner 则降为 `no_reply`（`group_generator.py:286-302`; `planner.py:762-794`）。

---

# 五、行动输出与反馈闭环

## 5.1 action dispatch 与目标选择

**[已实现事实]** Planner JSON 将 action 对象解析为 `ActionPlannerInfo`；action factory 从 global component registry 找 class，给该 action 传当前 `chat_stream` 和 originating `action_message`（`action_manager.py:31-98`）。`BaseAction` 从 `action_message` 提取 group/user target（`plugin_system/base/base_action.py:120-139`）。

**[代码推断]** 因而普通 action 的默认 target 是「触发它的 stream / message」，不是模型任意选择 platform/account/session；跨 stream 切换是专门 `switch_chat` action，且被标为 terminal，丢弃同轮其余 action（`heartFC_chat.py:1234-1239`）。该规则防止一轮跨 session side effects，却仍由 global runtime 维护，非 Life-level capability authorization。

## 5.2 多行动顺序、并发与降级

**[已实现事实]** reply 是 serial action，先于其他 serial action；`parallel_action=True` 的 actions 才以 `asyncio.gather(..., return_exceptions=True)` 并发（`heartFC_chat.py:1263-1311`）。`no_reply`、`wait_time`、`no_reply_until_call` 是 runtime first-class actions（`1804-1830`）。某些 image action 失败可 fallback 为 reply（`1965-1986`）。

**[已实现事实]** reply send 受 Focus lease，跨 split segments 同一 permit；送达后 `settle_reply_context_delivery`，异常/取消会 retain/release context（`heartFC_chat.py:1547-1605`）。这是一项值得借鉴的 action lifecycle discipline。

## 5.3 平台 API 与真实反馈

**[已实现事实]** outgoing `MessageBase.message_info.platform` 选择 `MessageServer` connection（`ncnk_message/api.py:233-237`）。Koishi adapter 根据 group 是否存在决定 OneBot `send_msg` 的 `group_id` 或 `user_id`（`adapter.py:264-297`），并串行 WebSocket send、5 秒 timeout、断线 drop（`305-340`）。

**[已实现事实]** OneBot 回应的 `status/retcode/echo` 只在 adapter receive loop 中记日志（`adapter.py:131-143`）。Core `UniversalMessageSender` 把 `get_global_api().send_message()` 未抛异常当作成功并随后持久化（`uni_message_sender.py:72-86,175-194`）。

**结论 [代码推断]**：平台收到 action request 是可观察的，真正平台 accepted/created-message feedback 没有被证明回到 planner/memory。`message_id_echo` handler 可更新 storage id（`src/chat/message_receive/bot.py:439-454`; `storage.py:156-175`），但 OneBot adapter 本段未显示发这个 custom message；因此该闭环是否实际启用为**[无法确认]**。

---

# 六、生命周期、并发与可靠性

**[已实现事实]** Main startup 依序起 memory、plugin、sandbox tools、mood、chat manager、Focus，再注册 message handler（`src/main.py:55-152`）。这避免 chat ingress 早于初始化；但异常策略对 A_Memorix 是 warn-and-continue（`59-71`），身份/Memory 可用性会退化而不是阻断启动。

**[已实现事实]** ChatStream 创建有 per-registry lock/task deduplication（`chat_stream.py:202-220`）。HeartFlow loop 在异常时 3 秒后重新建 task（`heartFC_chat.py:1464-1481`）；loop 内 action 可并发（见第五部分）。

**工程风险 [代码推断]**：global singleton 与 stream-specific loops 混合，使 process-wide config/model/plugin change 的 ownership、deactivation、multi-bot deployment 不清晰。Message sender 在 transport layer throw 后才标失败，但 adapter transport-level response 未形成 receipt；因此 at-least-once/duplicate suppression 的端到端语义不足。

---

# 七、扩展性与平台化能力

## 7.1 已有扩展面

**[已实现事实]**

- `ncnk_message` 用 `platform` 路由（`ncnk_message/router.py:278-312`）和 `BaseMessageInfo.additional_config` 承载 adapter metadata；
- plugin manager 在 startup `load_all_plugins()`，action class 经 registry 发现（`main.py:95-102`; `action_manager.py:61-88`）；
- adapter runtime capability 合同鼓励 core 不从平台名猜行为（`runtime_capabilities.py:1-5`）；
- action capability 用 `parallel_action` 标记协作（`heartFC_chat.py:1263-1311`）。

## 7.2 平台化限制

**[代码推断]** adapter 是独立进程/目录，但 core extension seam 仍以 global registry、global configuration、untyped additional config 为中心。它能扩展「更多 integrations/actions」，却不天然扩展「多种相互独立数字生命」。新增第二个 character 将触及 global persona、bot self id、global action/model config，而不是新建一个 first-class instance。

Athena 的目标则是 Cortex 仅依赖 capability、Nerve 实现 capability、一个 Nerve 代表一个 platform account connection（`docs/01-design-philosophy.md:149-173`）。正式 roadmap 尚未有 `ctx.tools`、non-IM Nerve、persistent Memory（`docs/06-progress-and-roadmap.md:55-68`），所以这是正确架构方向，非已完成平台能力。

---

# 八、工程质量与风险

| 方面           | 已确认优点                                                                         | 风险 / 不能照搬                                                                                     |
| -------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Transport      | 统一 message schema、可携带 media/format/capabilities（`message_base.py:219-337`） | `group_info/user_info` 与 sender/receiver 并存，core 仍依旧字段；account identity 不是 key 的一部分 |
| 认知循环       | Planner JSON action 与 Replyer 分工；特定 ReAct memory tool-loop                   | 两条模型 tool/action 语义并存；主 reply native tool call 未见 dispatch                              |
| 并发           | stream creation dedupe、serial/parallel action 显式划分、Focus permit              | 全局 singleton ownership；未证明 action idempotency 和 platform receipt 一致性                      |
| Prompt         | 可审计的固定 template 顺序、对 target/history 有 guard                             | 全部压入一条 prompt，system/user/tool provenance 丢失；retrieval fragment sanitation 无法确认       |
| Memory         | message persistence、mid/long-term 子系统、跨 chat access policy                   | startup 可降级运行；共享 memory policy 与 Life ownership 没有强边界                                 |
| LLM resilience | retry、413 compression、multi-model failover                                       | retry 在 LLM transport，不涵盖 side-effect actions；发送后未确认回执                                |

---

# 九、与 Athena Harness 的逐项比较

## 9.1 Athena 已明显领先

1. **强隔离与身份归属**：MessageService 会对 `internal/session` 解开 Cordis trace proxy，比对所属 `satori` isolate，并设置 `Context.filter` 只投递给同一 `message` isolate（`plugins/capability-message/src/index.ts:41-68`）。NachoBot 的 stream isolation 虽正确，但没有按 Life/instance 过滤 bus 事件的同等机制。
2. **one-Cortex-per-Life 生命周期约束**：`Life.bind`/Cortex disposer 是明确、可验证的 ownership contract（`plugins/life/src/life.ts:35-46`; `packages/protocol/src/cortex.ts:10-13`）；NachoBot 的 global ChatBot 无对应 instance contract。
3. **平台非特权的架构方向**：Athena 正式文档明确 Cortex 依赖 Capability 而非 Nerve、非 IM Nerve 与 IM 同级（`docs/01-design-philosophy.md:149-173`）；NachoBot 实际核心是 chat/adapter-oriented。

## 9.2 Athena 设计正确但尚未实现

1. **真正的 Life continuity**：Memory persistence、persona file 与 self-model 是 Phase 3，现为 `MemoryStub`（`plugins/life/src/life.ts:5-33`; `docs/06-progress-and-roadmap.md:258-290`）。
2. **可扩展认知/行动**：`ctx.tools`、Hook protocol 和 Cortex AI SDK tool-loop 尚未实现（`docs/06-progress-and-roadmap.md:193-244`）。
3. **多形态 Nerve/Cortex**：world/interlude、Minecraft/audio/expression capability 尚未实现（`docs/06-progress-and-roadmap.md:294-300` 及 `55-68`）。

## 9.3 Athena 当前明显不足

1. 当前 `CortexChat` 仅 echo，没有 NachoBot 已有的 planner、response composition、retry/failover orchestration、action registry（`plugins/cortex-chat/src/index.ts:15-44`; `docs/06-progress-and-roadmap.md:231-254`）。
2. Athena 的 `MemoryStub.search()` 恒返回空、无 persistence（`plugins/life/src/life.ts:5-19`）；NachoBot 至少已有 message storage、history retrieval/mid-term/long-term subsystem wiring。
3. Athena 尚未证明真实 adapter action feedback；NachoBot 的 adapter 至少处理 OneBot `status/retcode/echo` 日志（`adapter.py:121-143`），虽然还未是完整 Core receipt。

## 9.4 对方值得借鉴

- **以 target `ChatStream` 明确定义 action target**：将 `{platform, account, channel/group, recipient, correlation/message id}` 作为 Nerve act command 的 typed address，而非依赖 ambient context。
- **Planner action 的 serial/parallel 显式契约**：采用 `parallel_action` 和 reply first（`heartFC_chat.py:1263-1311`），但移入 Cortex action scheduler。
- **Focus effect permit/receipt settlement**：将「可发起」「已提交」「确实送达」明确为阶段，避免 session switch 中 late side effect（`heartFC_chat.py:1547-1605`）。
- **LLM 413 compression + model failover**：AIService 已有 candidate/group/circuit breaker 的基础，但具体 failover loop 应由 Cortex 组合（Athena 文档已明确，`docs/06-progress-and-roadmap.md:231-245`）。

## 9.5 不应照搬

- global `ChatBot`/`ChatManager` 作为 identity container；这会把多个 Life 压成一份 process state。
- `additional_config: dict` 作为 capability API；改用 versioned typed Capability event/act contract。
- 一个大 string prompt 兼装 identity、history、memory、tool info、user content；保留 AI SDK message roles/provenance，并在 Cortex 内以明确 budget 组装。
- 将 adapter reply log 当作 effect success；必须有 Nerve receipt 的 typed status 与 correlation id。

## 9.6 可能误导的表面相似点

1. 两者都有「memory」：NachoBot 的 memory ownership 以 `chat_id/stream` 和 global service 为主；Athena 的 memory 应属于 Life，不能等同。
2. 两者都有「plugins/actions」：NachoBot action registry 是 global capability collection；Athena `Tool/Capability` 必须受 Life scope 与 Cortex policy 约束。
3. 两者都有「跨平台」：NachoBot 的 platform field 做 route+session partition；Athena 的 Nerve 还承担 presence、双向连接与 Life ownership。
4. 两者都有「心流/loop」：NachoBot 的 HeartFlow 是内置聊天策略；Athena Cortex 必须允许 Reactive/Continuous/Narrative 的整体替换。

---

# NachoBot 专项深度分析

## A. 五组专项问题逐项结论

### A1. Adapter/receiver → normalization → identity → session 的完整链

见第二部分 2.2 的 10 步时序。核心事实是：adapter 在边缘做 platform raw payload 到 `BaseMessageInfo`，core 再 `MessageRecv.from_dict`，继而用 platform+group/user 生成 ChatStream key。`account/self id` 不进入 key，因而这是 per-platform conversation isolation，不是 per-account Life selection。

### A2. 主体/Agent 选择机制

**[已实现事实]** 在该完整链中没有 `agent_id`、persona registry、account→agent mapping 或 Life factory。`ChatBot`、`ChatManager` 均为 singleton，replyer 从 `global_config` 获得 bot identity（证据见第三部分 3.2）。

**结论 [代码推断]**：平台消息不是被路由到「多个 Agent 中的一个」；而是被路由至同一 Agent runtime 的某个 `ChatStream`。若添加多角色，现有设计会依赖多进程、配置切换或尚未展示的外部部署层，不能由本仓库源码确认。

### A3. Prompt/Persona/history/Memory/current event/tool result 的精确组合与持久化

- **Persona/System prompt**：主 reply 首部为 `{identity}`，但它是 string prompt 内容，不是 OpenAI `system` role（`replyer_prompt.py:11-28`; `utils_model.py:202-205`）。
- **History**：在 persona 后、current time/event 前；按 ChatStream SQL history、context size、split history 截断（`group_generator.py:1056-1070,1251-1258`）。
- **Current event**：`reply_target_block` 在 time 后，相关 target 先经 guard（`group_generator.py:1034-1054,1241-1262`）。
- **Memory**：template 的 knowledge/memory/mid-term/relation/tool/extra block 位于当前事件后、expression/moderation 前（`replyer_prompt.py:25-28`）；各 retrieval 并发构建后按模板确定性拼入（`group_generator.py:1123-1192`）。
- **tool result**：主 replyer 中 native tool calls 被记录为 `llm_response.tool_calls`，但本链未见消费或重入 LLM；不能确认其作为下一轮 prompt 的 result。Memory ReAct path 确实把 assistant tool call 和 observation 维持为 conversation message（`memory_retrieval.py:344-410`）。
- **写入/恢复**：入站先入 `Messages`，outgoing send 成功后入 `Messages`；ChatStream 可从 DB 恢复；long memory 启动失败降级（第三部分 3.3）。

### A4. LLM output → platform action、目标、顺序、结果可见性

- Planner output 是解析 JSON action，未知/错误 output 降 `no_reply`（`planner.py:776-794`）。
- Action target 自 originating `action_message` 的 group/user，outgoing message platform 来 current `chat_stream`（`BaseAction`/adapter 证据见第五部分）。
- reply serial first，parallel actions gather；`switch_chat` terminal（`heartFC_chat.py:1234-1311`）。
- LLM transport 支持 retry/failover，business action 出错只返回 failure/fallback，不保证 retry（`utils_model.py:303-476`; `heartFC_chat.py:1965-2003`）。
- OneBot requested send 在 log 可见，OneBot ack 也在 adapter log 可见；但 ack 无 typed Core feedback，所以 Planner/memory 能否依据真实 platform result 更新状态为**[无法确认]**。

### A5. 对 Athena 的严格边界建议

| 能力                                                                                                                                   | Athena 应归属                                | 依据与边界                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| raw platform webhook/WebSocket、normalization、platform/account/message/channel/user identifiers                                       | **Nerve**                                    | Nerve 负责世界双向接触；必须附 `nerveInstanceId`/account id 与 typed origin，不可让 Cortex 解析 OneBot/Discord raw payload。                      |
| send/edit/delete/reaction/voice 等 concrete API、transport retry、ack/receipt                                                          | **Nerve（实现 Capability 的 act endpoint）** | Capability 声明 protocol；Nerve 兑现它并返回 `Pending/Accepted/Delivered/Failed` receipt。不要把 adapter API 或 client 泄漏到 Cortex。            |
| response choice、willingness、per-conversation ordering、aggregation、LLM failover、tool-call policy、多 action dependency/parallelism | **Cortex**                                   | 这些是「如何活着」的整块策略；不能全局化为 event→reply middleware。参考 NachoBot action scheduler 但保持 Cortex 可替换。                          |
| Persona、long-term memory、self-model、cross-Nerve continuity、instance/account binding policy                                         | **Life / Memory / Instance**                 | Life 是 identity owner；Instance declaratively wires one Life to its Nerves. Cortex 可读写 memory via contract，不能拥有 global mutable persona。 |
| generic Message/World action contract、Nerve registry、tool definition type                                                            | **Capability**                               | 为 Cortex 提供稳定抽象，避免 `additional_config` dict；capability 不该拥有 identity/memory。                                                      |

### A6. 会破坏 Athena 隔离的做法

1. 将 `ctx.ai`、tool registry、message history、persona 或 model policy 放进 root global mutable singleton；这会复现 NachoBot 的 shared Agent ambiguity。
2. 在 Cortex 读取 adapter/bot raw context 或按 `platform` 字符串判断 capability；Athena 应继续经 `ctx.message` / capability API。
3. 将 conversation key 仅定义为 `platform + group/user`；至少必须命名 `lifeId + nerve/account id + peer/channel`，否则一个 Life 的两个账号和两个 Life 同平台都会污染。
4. 允许 cross-session memory 默认全局 read；应由 Life Memory policy 显式 authorise，并把 memory record 的 `lifeId`、source Nerve/account、visibility/scope 留为不可省略 provenance。
5. 把 platform ack log 当作 memory write 成功；只有 Nerve 结构化 receipt 达到确切状态才允许 Cortex enactment 后更新 self-model/Memory。

### A7. 保留统一 Life 而避免多平台污染的可执行形状

建议 Life 保持一个 canonical identity；每条入站 event 用不可伪造的 `WorldEvent` origin：

`{ lifeId, nerveId, accountId, platform, conversationId, participantIds, messageId, timestamp, content, capabilities }`。

Cortex 选择一个 **conversation context key = `lifeId/nerveId/accountId/conversationId`** 维护短期 buffer/lock/history；Memory 默认 `Life-private`，只有 retrieval policy 有明确 `crossConversationRead` 许可才读取跨 context record。回复 action 必须携带被选择 `nerveId/accountId/conversationId`，Nerve 返回 receipt。这样同一个 Life 能记住跨平台经历，却不会把 A 平台私聊的 recent history 或 B 账号的发信权限错误带入当前 Cortex turn。

---

# 对 Athena 开发方向与优先级的影响

## P0：先固化「Life-bound context + Nerve receipt」契约

**建议**：在 message Capability/未来 Tool Registry 定义 typed inbound origin 与 outbound Act/receipt；Instance 显式绑定 Life ↔ Nerve/account；Cortex 内部以 `(life, nerve/account, conversation)` 作串行/聚合 key。

**证据**：NachoBot 仅 `platform+group/user` 生成 stream id（`chat_stream.py:177-200`）且 outgoing ack 未入 core receipt（`adapter.py:121-143`; `uni_message_sender.py:175-194`）；Athena 已有 per-Life event filter 根基（`plugins/capability-message/src/index.ts:60-68`），应在扩展前守住该边界。

## P0：实现 Cortex Chat 的最小真实 cognition/enactment，但不要复制全局 pipeline

**建议**：按 Athena 正式 Phase 2-C 先完成 per-conversation lock/aggregation、persona+recent history+Memory integration、AI SDK failover、`send_message`/`wait` Layer 2 tools、无输出静默及 Hook emit（`docs/06-progress-and-roadmap.md:231-254`）。

**证据**：当前 `CortexChat` 是 echo（`plugins/cortex-chat/src/index.ts:31-43`）；NachoBot 的 reply-first serial plus optional parallel scheduling（`heartFC_chat.py:1263-1311`）显示须由 Cortex 负责编排，而不是在 framework root 建 global HeartFlow。

## P1：让 Memory 成为 Life-owned、provenance-aware persistence

**建议**：以 sqlite `MemoryProvider` 实现 Life-bound store/retrieve/search；存 record source Nerve/account/conversation、privacy/scope、time、effect receipt correlation。短期 history 属 Cortex context，不直接冒充 Life Memory；提供显式 cross-context recall policy。

**证据**：Athena `MemoryStub` 无 search/持久化（`plugins/life/src/life.ts:5-19`）；NachoBot 证明 history/mid/long memory 多层是现实需求，却也揭示 cross-chat access 若无 Life policy 会含混（`A_memorix/_compat.py:123-212`）。

## P1：定义 Tool/Capability 的两层 action model

**建议**：Layer 2 `send_message`、`wait` 是 Cortex 语义；Layer 3 tools 是 Capability registrations，附 effect class、target constraints、parallel-safe/idempotency metadata；Cortex 决定 execution plan，Nerve 将 media/platform action 兑现。

**证据**：NachoBot 既有 provider-native tool calls 又有 JSON planner actions，主 reply native tool results 未见 dispatch（`utils_model.py:179-234`; `group_generator.py:1481-1497`）。Athena roadmap 的 Tool Registry 已计划 local→Life→global 可见性和统一 execute（`docs/06-progress-and-roadmap.md:193-198`），应补 target/receipt，而非改成 raw dict。

## P2：将 Focus/attention 作为可选 Cortex 模块，不升级为 Life global state

**建议**：未来借鉴 NachoBot Focus permit 的 late-side-effect 防护，但以 Cortex-local scheduler/lease 实现。Continuous/Interlude Cortex 可选择不同 policy。

**证据**：NachoBot 的 permit 覆盖完整 logical reply 并处理 cancellation（`heartFC_chat.py:1547-1605`）；Athena 明确 Cortex 是完整、不可热切换策略，push event 的串行化是 Cortex 职责（`docs/01-design-philosophy.md:104-116,177-228`）。

## 应暂缓事项

1. **暂缓**把 NachoBot 全量 planner/action registry 移进 Athena core：会违反 Cortex 整体可替换与非聊天优先原则。
2. **暂缓**全局 cross-Life/shared-memory：没有 Instance、persistent memory 与 explicit consent/scope contract 前，这会破坏已实现 multi-Life isolate。
3. **暂缓**设计「万能 adapter config dict」：先稳定 Capability contracts 与 receipt schema，再做 adapter-specific optional extension。
4. **暂缓**将 system/persona/history 全字符串拼接为默认 LLM abstraction：应先建立 provenance/role/budget contract，才能安全支持 tool result、Memory 与多个 Nerve。
