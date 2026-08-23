# MaiBot context assembly 机制报告（当前源码快照）

> **一句话总结：** MaiBot 不是“一个拼好的单字符串 prompt”：当前实现是 per-session `MaisakaHeartFlowChatting` 驱动的 **Planner structured `ContextItem[]` + out-of-band tool definitions → sequential Action/tool loop → Replyer structured `ContextItem[]` → delivery/history writeback**；模板只填充 system/user Item，缓存友好性主要来自把时间、memory/profile、focus 事件放在尾部，但 Planner/Replyer 的 system Item 仍含会变的全局/会话字段。

## 0. 证据边界与标签

- **[已实现事实]** 以下以 `/home/workspace/references/MaiBot` 当前源码和 `prompts/zh-CN` 为最高证据；`docs/research/native-digital-life-framework/05-maibot.md` 只作为待核对的旧研究文档。
- **[代码推断]** “缓存友好/不友好”“identity ownership”等是由实际字节顺序和调用关系推导，不等同于已观测的 provider cache 命中率。
- **[无法确认]** 未启动 MaiBot、未连接具体模型/Provider，不能把 wire converter 的存在等同于外部 Provider 一定按相同 cache 规则运行。
- 当前快照中的实际核心路径是 `src/maisaka/*`、`src/chat/replyer/*`、`src/maisaka/builtin_tool/*`；旧文档引用的 `src/chat/heart_flow/*` 等路径在当前树中未发现。

## 1. 结论先行

1. **[已实现事实] Planner 与 Replyer 是两个真正不同的 LLM stage。** Planner 负责分析/决策并产生 function/tool calls；`reply` tool 才进入 Replyer，Replyer 负责可见文本。`reply` tool 本身不是另一个“Action LLM”；Action 是 Planner 输出后的应用侧执行阶段（`reasoning_engine.py:2030-2129`，`builtin_tool/reply.py:295-370`）。
2. **[已实现事实] 主请求是结构化消息数组，不是单 prompt。** `MaisakaChatLoopService._build_request_messages()` 生成有明确 `system/user/assistant/tool` 角色的 `ContextItem` 列表（`chat_loop_service.py:889-978`）；OpenAI Chat Completions 再转换为 `messages[]`（`openai_client.py:502-568`），Responses API 转换为 `input[]`（`openai_responses_client.py:185-234`）。模板文本只是第一个 system Item 的内容。
3. **[已实现事实] Planner 与 Replyer 使用不同的人格字段。** Planner system template 使用 `bot_name + behavior_style`；Replyer system template 使用 `identity + reply_style`，其中 `identity` 是 nickname/aliases/personality/emotion suffix，不是 `behavior_style`（`chat_loop_service.py:763-773`；`maisaka_generator_base.py:89-120,555-580`；`prompts/zh-CN/maisaka_chat.prompt:1-31`、`maisaka_replyer.prompt:1-6`）。
4. **[已实现事实] Planner 的自动 memory/profile 是本轮尾部 user 注入，不是永久 history entry。** `_build_planner_injected_user_messages()` 并行构造 deferred-tools reminder、heuristic memory、person-profile，再由 `_build_request_messages()` 放到历史之后（`reasoning_engine.py:489-531`；`chat_loop_service.py:945-978`）。
5. **[已实现事实] Replyer 默认过滤掉 Reference/ToolResult/mid-term memory，只接收保留下来的真实会话消息；Planner reasoning 只有在 `reply` tool 显式传 `reply_reference` 时才会进入 Replyer 的 user tail，默认则以 `reply_reason` 形成“当前思考”参考（`maisaka_generator_base.py:615-645,650-745`；`builtin_tool/reply.py:85-125`）。
6. **[已实现事实] Context trimming 是 message-count + tool-turn closure，不是简单字符串截断。** Planner 选最近消息，effective window 为配置值与 `2×配置值` 的较大者；工具轮按 `logical_turn_id` 补齐，必要时允许 overflow（`chat_loop_service.py:1203-1285`）。周期后再做一次结构规范化、可选 assistant/tool folding、超过 `2×max_context_size` 时裁到 `max_context_size`（`context/post_processor.py:41-99,107-257`）。
7. **[代码推断] 缓存排序有明确优点也有明确污染点。** Planner 将 current time、memory/profile、focus tail、chat-specific attention 放在 history 后的 user tail，适合复用较长前缀；但 Planner 和 Replyer 的 system Item 位于首位且含 behavior/personality/group/focus 动态值，跨会话或配置变化会从第一 Item 就失配。Provider 的实际 cache boundary/quantization 未由静态源码确认。

## 2. 模板加载与 placeholder granularity

### 2.1 两套加载器，不要混为一谈

- **[已实现事实]** 系统启动仍调用 `prompt_manager.load_prompts()`（`src/main.py:140`）；`PromptManager` 支持自定义覆盖、locale layer、nested prompt/context function，并把模板装入内存（`src/prompt/prompt_manager.py:320-424`）。
- **[已实现事实]** 当前 Planner service 直接 `from src.common.prompt_i18n import load_prompt`，不是通过 `prompt_manager.get_prompt()/render_prompt()`（`src/maisaka/chat_loop_service.py:12-18`）。`load_prompt` 每次根据当前 locale 解析模板路径，然后执行普通 `template.format(**kwargs)`；requested locale 不存在时回退 `DEFAULT_LOCALE`，custom prompt 优先（`src/common/prompt_i18n.py:248-300,344-414`）。
- **[已实现事实]** 非 strict 模式下缺 placeholder 会记录 error 并返回未格式化模板；strict 模式（pytest 或环境变量）才抛错（`prompt_i18n.py:378-414`）。因此“placeholder 一定被替换”不是无条件保证。
- **[代码推断]** `PromptManager` 启动加载并不表示主 Planner 的模板在启动后冻结；Planner active path 的 `load_prompt` 仍按调用重建动态字符串，底层文件读取由 `_read_prompt_template` 的 `lru_cache` 缓存。

### 2.2 `prompts/zh-CN` 的实际占位符

| Active/auxiliary template                | 实际 placeholders                                                                                                                  | 进入位置与含义                                                                                                                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maisaka_chat.prompt:1-31`               | `bot_name`, `behavior_style`, `group_chat_attention_block`, `query_memory_rule`                                                    | Planner system Item；末尾固定要求输出分析并按需调用工具                                                                                                                                            |
| `maisaka_chat_focus.prompt:1-38`         | `bot_name`, `behavior_style`, `group_chat_attention_block`, `planner_idle_focus_rule`, `query_memory_rule`                         | Focus Planner system Item；额外解释 `<focus_chat_event>`、`switch_chat`、`fetch_history`                                                                                                           |
| `maisaka_replyer.prompt:1-6`             | `identity`, `reply_style`, `group_chat_attention_block`, `replyer_output_instruction`                                              | Replyer system Item；只约束日常口语化可见回复                                                                                                                                                      |
| `expression_select.prompt:1-17`          | `chat_observe_info`, `bot_name`, `target_message`, `reply_reason_block`, `all_situations`, `max_num`, `target_message_extra_block` | **[已实现事实] 当前 active selector 不直接使用它**；当前 `MaisakaExpressionSelector` 用 `_build_selector_prompt()` 硬编码 JSON selector prompt（`maisaka_expression_selector.py:274-290,527-561`） |
| `mid_term_memory_summary.prompt:1-?`     | `time_range`, `participants_text`                                                                                                  | 摘要 LLM 的 system instruction（`mid_term.py:330-360`）                                                                                                                                            |
| `heuristic_memory_impression.prompt:1-?` | `chat_identity`, `message_window`                                                                                                  | heuristic recall 的 utils LLM impression prompt（`heuristic_injector.py:175-180`）                                                                                                                 |

**重要纠正：** `MaisakaChatLoopService.build_prompt_template_context()` 虽然传入 `file_tools_section`，但 `maisaka_chat.prompt` 与 `maisaka_chat_focus.prompt` 当前均没有 `{file_tools_section}`；Action tools 不会通过这一 placeholder 拼到 system prompt，而是作为 `LLMGenerationOptions(tool_options=...)` 的独立工具定义发送，deferred tools 则以尾部 `<system-reminder>` user Item 注入（`chat_loop_service.py:763-773,1015-1064`；`reasoning_engine.py:448-489`）。

## 3. 阶段边界与机制表

| 阶段                              | 实际入口/边界                                                                                                                                                                                                       | Prompt/template 与 placeholders                                                                        | 发给模型的 context/roles/order                                                                                                                                                                                                                                                                                                  | history/memory/persona 差异                                                                                                                                                                           | trim/compression                                                                                                                                                                  | cache implication                                                                                                                                              | 证据                                                                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Runtime/turn start**            | `MaisakaHeartFlowChatting` 保有 session-local `_chat_history`、`message_cache`、internal queue、tool registry、reasoning engine；`run_loop()` 开 cycle（`runtime.py:139-223`；`reasoning_engine.py:1015-1080`）     | 无独立模板                                                                                             | 尚未发模型；可能先 refresh visual placeholders、mid-term reference                                                                                                                                                                                                                                                              | session key 隔离短期 history；global config/personality 仍共享                                                                                                                                        | 启动恢复最近消息并加 `CONTEXT_RESTORE` reference（`runtime.py:316-401`）                                                                                                          | 新 session 的恢复 reference 会改变首段 history；reference 不占普通 count 但可被强制选择                                                                        | 同左                                                                                              |
| **Planner context preparation**   | `_run_planner_request()` → `_build_action_tool_definitions()` + `_build_planner_injected_user_messages()` → `_run_interruptible_planner()`（`reasoning_engine.py:448-531,620-740`）                                 | `maisaka_chat` 或 Focus 版；Planner `bot_name/behavior_style/...`                                      | 先 system；随后 selected history；跨日时插入 user 时间边界；尾部依次为 deferred reminder、heuristic memory、profile、current time、focus tail/current-chat attention；最后另加 planner final user reminder（`chat_loop_service.py:889-978,1000-1030`）                                                                          | 自动 memory/profile 是本轮 user tail；mid-term body 被 Planner request-kind filter 排除，但 recall reference 可作为 Reference(user)；persona 主要 behavior_style                                      | selected history 从尾部反向取；effective window `max(base, 2×base)`；context restore reference always-selected；tool turn closure 可 overflow（`chat_loop_service.py:1203-1285`） | 尾部 volatile data 不污染早期 history prefix；但 dynamic system 首项仍可导致整段 cache miss；window sliding 会移动首项 history                                 | `chat_loop_service.py:80-87,740-840,1160-1285`                                                    |
| **Planner LLM request**           | `chat_loop_step(request_kind="planner")` → `LLMServiceClient.generate_response_with_context()`（`chat_loop_service.py:985-1123`）                                                                                   | system template 是一个 string Item                                                                     | `ContextItem[]`；OpenAI Chat 转 `messages[]`，Responses 转 `input[]`；`tool_options` 单独传，不是正文                                                                                                                                                                                                                           | 输出可有 assistant text/reasoning/function-call/provider activity；Planner output Item 后写回 history                                                                                                 | visual mode 再限制 latest images（`chat_loop_service.py:1024-1028,1085-1089`）                                                                                                    | tool definitions 的 order/visibility/discovery 也属于 request payload；具体 Provider cache 是否把 tools 独立计入未知                                           | `context_item.py:22-28,360-500`; `openai_client.py:502-568`; `openai_responses_client.py:185-234` |
| **Action/tool loop**              | `_handle_planner_response_actions()` 将 Planner output 写 history；`_handle_tool_calls()` 按序 invoke registry（`reasoning_engine.py:150-238,2030-2129`）                                                           | 无独立 Action template；builtin tool specs 是 tool definitions                                         | 每个 tool call 是模型输出的 `FunctionCallItem`；应用执行后 append `ToolResultMessage`/`FunctionCallOutputItem`，下一 Planner round 再送回；顺序执行，不是 action LLM                                                                                                                                                            | Action 没有自己的 persona；tool invocation 带 latest planner reasoning、session/stream/target metadata                                                                                                | `wait` 等 pause 工具可暂停；tool result 可能带 post-history messages/media；后续 trim 保持完整 logical turn 或折叠                                                                | 每个 action round 会在 history 中追加 assistant function-call + tool result，前缀通常稳定增长；工具 definitions 变化会触发 payload 差异                        | `builtin_tool/__init__.py:39-105`; `reasoning_engine.py:2030-2129`; `context/messages.py:660-760` |
| **Reply action boundary**         | Planner 调 `reply(msg_id, reply_reference?, reply_style?, ...)`；reply handler 更新 stage 为 Replyer（`builtin_tool/reply.py:295-370`）                                                                             | Replyer active loader 渲染 `maisaka_replyer`；不存在 `{behavior_style}`                                | Action 仅传 target message、latest planner reasoning、reply args、current runtime history 给 Replyer                                                                                                                                                                                                                            | `reply_reference` 是 planner 显式可控的 memory/fact/relationship handoff；没有它，Replyer 只拿 `reply_reason` 的“当前思考”user reference                                                              | reply action 自身不 trim；依赖 runtime 已 post-processed history                                                                                                                  | target id、reply args、duplicate-target reminder 等每轮变化，位于 Replyer 尾部；system 仍含全局/personality 动态值                                             | `builtin_tool/reply.py:85-125,295-370`                                                            |
| **Replyer main LLM**              | `generate_reply_with_context()` → optional expression selector → `_build_request_messages()` → model context factory（`maisaka_generator_base.py:985-1190`）                                                        | system `identity + reply_style + group_chat_attention_block + replyer_output_instruction`              | 顺序：system；filtered real chat history；optional expression habits(user)；temporary style(user)；reply reference/current planner thought(user)；final user block(current time, target, requirements, keyword reaction, attachments, output rule)；optional requested reply style(user)（`maisaka_generator_base.py:650-745`） | Replyer filters `ReferenceMessage`, `ToolResultMessage`, tool-result-media, mid-term memory; guided_reply self messages become assistant; base ModelOutput visible assistant extraction returns empty | **没有独立 context-size selection**；使用当前 runtime retained history，最后按 visual model limit images；Hook 可改写 Item                                                        | system 首项不稳定；历史中 user/assistant prefix 可复用；target/time/requirements 在尾部；before_model_request/retry/model visual capability 可重建全部 request | `maisaka_generator_base.py:615-745,985-1190`                                                      |
| **Expression selector sub-agent** | Replyer 前 `MaisakaExpressionSelector.select_for_reply()`；`run_sub_agent(context_message_limit=10, request_kind="expression_selector")`（`builtin_tool/reply.py:73-80`; `maisaka_expression_selector.py:574-643`） | 当前是硬编码 selector system prompt，不是 `expression_select.prompt`；候选池最多按 selector 规则选 0–5 | 父 history 仅 `SessionBackedMessage`，最多 context limit 10（再受 2× stability window）；候选表达方式直接在 system prompt；无 tools                                                                                                                                                                                             | 只看最近真实聊天和候选 expressions，不带 Reference/ToolResult/person profile；结果变成 Replyer 的 `expression_habits` user Item                                                                       | 候选不足 10 条时跳过 LLM；无 selector runner 时直接注入                                                                                                                           | 候选池、候选顺序、chat tail、current time 都可能变；短 prompt cache 价值有限                                                                                   | `maisaka_expression_selector.py:274-290,349-400,527-561,574-643`                                  |
| **Post-cycle trim/summary**       | `_end_cycle()` → `process_chat_history_after_cycle()`（`runtime.py:1280-1400`）                                                                                                                                     | 可选 `mid_term_memory_summary` auxiliary template                                                      | Summary LLM: system instruction + selected removed user/assistant/tool-compatible source Items; default no visual; `MAX_SUMMARY_INPUT_CHARS=16000`                                                                                                                                                                              | 只把裁掉的 `role==user`、非 mid-term、有文本消息拿去摘要；summary 作为 ComplexSessionMessage 保存；Planner 直接 filter body，按 query 可召回 Reference                                                | one-shot refs consume/remove；normalize orphan tool results；可选保留最新 3 assistant units并折叠旧 tool turns；超过 `2×max` 才裁到 max；summary 数量受 config 限制               | Summary 是慢路径独立请求；插入新 history item 会改变之后 Planner prefix，但比每轮重写全部历史更稳定                                                            | `context/post_processor.py:41-99,107-257`; `mid_term.py:106-176,330-360`                          |

## 4. 角色、历史、memory、persona 的逐 stage 对照

### 4.1 Planner

- **Roles [已实现事实]**：system template 是 `SystemMessageItem`；真实 session messages 与 Reference messages 投影为 `UserMessageItem`；模型可见正文/模型工具调用投影为 assistant/function-call；工具结果为 `FunctionCallOutputItem`/OpenAI `role=tool`（`context/messages.py:459-760`；`openai_client.py:515-568`）。
- **History [已实现事实]**：Planner 看到可选的 assistant output、tool-call/result closure、真实 user session messages、context-restore/jargon/memory/behavior references；`request_kind="planner"` 只显式排除 mid-term summary body（`chat_loop_service.py:1348-1360`）。
- **Memory [已实现事实]**：
  - heuristic memory：先由 `heuristic_memory_impression` utils LLM 从 recent DB window 生成 impression，再按 session/person/cross-chat policy 检索；注入块上限来自配置，默认是一次性 Planner user tail（`heuristic_injector.py:64-180,260-320`）。
  - profile：私聊取当前 sender；群聊按当前/最近 speaker、@、reply target 收集，最多配置数量（默认 3），每个 profile text 再截到 900 chars，合成 `【人物画像-内部参考】`（`person_profile.py:146-285`）。
  - mid-term：裁切后生成摘要；下一轮只在 embedding recall 命中时追加 `ReferenceMessage(MEMORY)`，而不是每轮无条件展开全部摘要（`mid_term.py:323-390`）。
- **Persona [已实现事实]**：Planner 仅在 system template 中读取全局 `bot.nickname` 与 `personality.behavior_style`，再加 chat type attention/query-memory rule；没有 `life_id` 参数。

### 4.2 Action

- **[已实现事实]** builtin entries 明确声明 `stage="action"|"both"` 与 `visibility="visible|deferred|hidden"`；`wait` 为 `both`，`reply/query_memory/query_person_profile/send_image/send_emoji/tool_search/fetch_history/switch_chat` 为 action，`view_forward_message` 默认 deferred（`builtin_tool/__init__.py:39-105`）。
- **[已实现事实]** Planner 只拿 visible definitions；deferred tools 以 `<system-reminder>` user tail 告知，先 `tool_search` 后才能在下一轮变为可用 definition（`reasoning_engine.py:448-489`；`runtime.py:1480-1615`）。
- **[代码推断]** “Action LLM request”若指一个与 Planner 分开的 action model call，当前主链没有这个阶段；真正的额外模型调用只来自具体 tool/sub-agent（例如 expression selector、emoji selector、memory impression、mid-term summary）。

### 4.3 Replyer

- **Persona [已实现事实]** `_build_personality_prompt()` 组合：bot nickname、aliases、`global_config.personality.personality`（空时 fallback“是人类。”）、emotion trait suffix；template 再加 `reply_style`。因此“Planner 和 Replyer 共用同一 behavior_style”是错误描述。
- **History [已实现事实]** Replyer 使用调用方传来的 runtime history，并先过滤 `ReferenceMessage`、`ToolResultMessage`、tool-result-media、mid-term memory；真正 `guided_reply` self messages 转 assistant，普通 session messages 转 user（`maisaka_generator_base.py:615-745`）。
- **Planner reasoning/memory handoff [已实现事实]** `reply_reason` 若未给 `reply_reference`，会形成 `当前思考：...` 的 user reference；`reply_reference` 可由 Planner 在 `reply` tool args 中显式传入，schema 描述它可承载 chat state/person relation/facts/memory（`maisaka_generator_base.py:700-730`; `builtin_tool/reply.py:95-104`）。
- **重要边界 [代码推断/无法确认]** `query_memory.py` 会在 ToolResult metadata 写入 `replyer_memory_reference`（`query_memory.py:137-180,317-323`），但当前仓库搜索不到该 key 的 Replyer consumer；因此不能把“memory 查询结果自动透传到 Replyer”当成已证明行为。当前可证明的 handoff 是 Planner 显式填 `reply_reference`。

## 5. 七个目标场景的实际路径

> 原 assignment 摘要未在可见文本中列出七个场景名称，以下按“per-request rebuild / world-state-like snapshot / append-only history / cache-prefix stability”所需覆盖面给出七类机制场景；每项都对应当前代码路径，不把场景名伪装成源码术语。

### 场景 1：普通新消息触发 Planner

1. session runtime 收集/转换新 `SessionMessage` 为 `SessionBackedMessage(User)`。
2. Planner 选最近 `effective_context_size=max(config,2×config)` 条普通上下文，system 放最前，历史按时间顺序展开。
3. current time、chat attention、planner final reminder 放尾部；工具定义作为独立 request option。
4. 模型输出 assistant text/tool calls；无 tool 时按 no-tool policy 结束，有 tool 时进入场景 3。

**结论 [代码推断]：** 这是 per-request rebuild，但历史前缀保留策略比“每轮全量拼新字符串”更有 cache 价值；首个 system Item 的动态字段仍是首要风险。

### 场景 2：需要长期记忆或人物画像

1. Planner 请求前并行做 heuristic memory 与 profile injection。
2. 结果不是写入 `_chat_history`，而是以 user tail 本轮注入；人物画像内容带“内部参考、冲突以当前对话为准”。
3. Planner 若继续调用 `reply`，必须通过 `reply_reference` 把需要 Replyer 使用的事实显式带过去；仅有 ToolResult 并不能证明 Replyer 自动读取。

**结论 [代码推断]：** Planner 与 Replyer 的 memory visibility 是有意不同的“决策上下文 vs 表达上下文”，但 metadata handoff 目前存在未消费的疑点。

### 场景 3：Planner 调用一个或多个 Action tools

1. `_build_action_tool_definitions()` 按 stage/visibility/provider 构造 definitions。
2. Planner 输出 function calls；`_handle_tool_calls()` 严格按返回顺序执行并写 ToolExecutionRecord/ToolResult。
3. Tool result 回到下一 Planner request；pause tool 可结束当前内部循环，普通 tool 继续下一 round；最多 `MAX_INTERNAL_ROUNDS`（当前 runtime 常量路径见 `runtime.py`）。

**结论 [已实现事实]：** 这是原生的 LLM → Action → Observation → LLM 闭环，不是 Planner 输出 JSON 后另有一个独立 Action LLM。

### 场景 4：Planner 决定可见回复，进入 Replyer

1. `reply(msg_id, reply_reference?, reply_style?)` 验证 target。
2. Replyer 可先运行 expression selector；随后主 Replyer system/history/tail array 发模型。
3. 输出经 before-post-process hook、splitter/typo/rich-reply parser，再逐段发送。
4. 发送成功才 `sync_to_maisaka_history=True` 写回 `guided_reply`；当前代码还会在成功发送后通知 memory automation（send path 与 memory service 的现有代码；具体 transport accepted semantics 仍需外部 adapter 验证）。

**结论 [已实现事实/代码推断]：** 可见回复不是 Planner 正文直接发送，Planner 的 assistant reasoning 也不会自动成为用户可见文本。

### 场景 5：Focus mode / 跨聊天观察

1. Focus 选择 `maisaka_chat_focus.prompt`，同一 session 只有当前 chat active。
2. Focus event 以独立 user messages/tail 语义进入 Planner；`fetch_history`/`switch_chat` 只在 Focus 可用，deferred tool/discovery 仍遵守当前上下文。
3. Replyer 仍是当前目标消息的单 chat replyer，不共享 Focus Planner 的全部 Reference history。

**结论 [已实现事实]：** Focus 是 Planner 的 chat-selection policy，不是独立 Life/world Cortex；跨 chat event 的动态尾部会降低该轮尾部 cache 命中，但不应污染稳定历史前缀。

### 场景 6：重启、历史裁切与 mid-term summary

1. runtime 启动从 DB 恢复最近消息，添加带离线时长的 `CONTEXT_RESTORE` Reference。
2. 周期后按 one-shot/reference/tool-closure 规则清理；启用 optimization 时折叠旧 tool turns；超过 `2×max` 才裁到 max。
3. 被裁内容可进入 `mid_term_memory_summary` LLM（system + source Items，输入字符上限 16000），摘要保存为 Complex message；后续按 query/embedding recall 生成内部 Reference。

**结论 [已实现事实]：** MaiBot 不是 append-only 永久完整 prompt；它维护 append-like runtime history，但会做结构化裁切、tool folding、summary replacement。

### 场景 7：视觉输入、retry、cache-prefix 诊断

1. Planner/Replyer 根据 model visual capability 调 `limit_latest_images_in_messages()`，限制最新图片数量。
2. Provider 返回 413 时，LLM orchestrator 会调用 `compress_messages()` 压缩图片并重试；该重试会改变 image Item bytes，因此不可视为原 prompt 的同字节 replay（`utils_model.py:1053-1075`）。
3. LLM cache stats 对 wire payload/messages 做 common-prefix、dynamic-diff、context-sliding 诊断（`llm_cache_stats.py:369-470`）；记录的是理论/实际 usage 统计，不等于保证 Provider cache 命中。

**结论 [代码推断]：** 当前最 cache-friendly 的设计是“稳定 system/history prefix + volatile user tail”；最危险的变化是 system template/personality/focus 变化、window sliding、tool definition discovery、以及 image compression retry。

## 6. Prompt-cache ordering 审计

### Planner 实际顺序

```text
[0] system: maisaka_chat(_focus) rendered template
[1..N] selected history: user session / assistant model output / function call / tool result / selected references
      + planner-only day-boundary user time markers when date changes
[N+1..] user: deferred-tool reminder (if any)
[N+2..] user: heuristic-memory reference (if any)
[N+3..] user: person-profile reference(s) (if any)
[N+4] user: current wall-clock time
[N+5] user: focus tail / current-chat attention (if any)
[last] user: fixed planner final reminder containing bot_name
```

- **[代码推断] 好的排序：** current time、profile、memory、focus events 不放 system，且多数位于 history 之后；如果新增事件只追加尾部，稳定前缀可复用。
- **[代码推断] 坏的排序：** `behavior_style`、group/private attention、query-memory rule 和 Focus/non-Focus template 处在 system 首项；跨 chat 或配置变动会使 prefix 从 Item 0 分叉。
- **[已实现事实]** cache-stability ratio=2.0 只减少 context sliding 频率，不能修复 system 首项 volatility；tool-turn closure 还可能让请求超过 effective window。

### Replyer 实际顺序

```text
[0] system: identity + reply_style + group/chat attention + output instruction
[1..M] filtered retained history: user messages + guided_reply assistant messages
[M+1..] user: expression habits
[M+2] user: temporary reply style
[M+3] user: reply_reference or Planner current thought
[M+4] user: current time + target msg + retry/keyword/attachment/output instructions
[last?] user: requested reply style (if supplied)
```

- **[代码推断]** Replyer 的 history prefix 比 Planner 简单，但 system 更强 volatile（personality/reply_style/chat attention），target/current time 在尾部；retry hook 会重建 tail。
- **[无法确认]** 不同 Provider 对 system/user message cache 的具体分段规则、tool definitions 是否单独 cache、以及 Responses replay fragment 的实际服务端命中，不能只由本地代码确认。

## 7. 对 `05-maibot.md`/既有 MaiBot 描述的纠正

| 旧描述/容易误读                                                                  | 当前源码纠正                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| “核心对象/路径是 `src/chat/heart_flow/heartflow_manager.py`，可据此解释当前实现” | **[文档陈旧]** 当前源码树实际核心是 `src/maisaka/runtime.py` + `src/maisaka/reasoning_engine.py` + `src/chat/replyer/*`；旧文档引用的 `src/chat/heart_flow/*` 在本快照未发现。旧文档的架构结论不能直接作为当前行号证据。         |
| “Prompt Manager 负责主 Planner prompt 的模板装配”                                | **[纠正]** 启动确实调用 `prompt_manager.load_prompts()`，但 active Planner service 直接调用 `common.prompt_i18n.load_prompt()`；Replyer 通过注入的 loader 调用模板。两套 loader 的缓存/覆盖语义不能混写。                        |
| “Planner 把工具说明拼进 prompt 的 `{file_tools_section}`”                        | **[纠正]** `file_tools_section` 只是 context dict 中的 unused key；zh-CN Planner templates 没有该 placeholder。可见 tool definitions 走 `LLMGenerationOptions.tool_options`，deferred tool 说明走尾部 user `<system-reminder>`。 |
| “planner/action/reply 都是字符串 prompt 或 Planner JSON action”                  | **[纠正]** 主 Planner/Replyer 都构建 `ContextItem[]`；Planner tool calls 是统一 FunctionCall Items/native function tools，Action 是应用侧 invoke；Replyer 是第二个 structured request。只有模板片段本身是字符串。                |
| “Persona 在每个阶段相同，主要是 `behavior_style`”                                | **[纠正]** Planner 用 `behavior_style` 做决策；Replyer 用 `personality.personality + aliases + emotion suffix + reply_style` 生成表达身份。两者刻意不同。                                                                        |
| “Replyer 自己按 context size 拆 core/background history”                         | **[纠正]** 当前 Replyer 没有独立 max-context selector；它使用 runtime 已保留的 history，再过滤 Reference/ToolResult/mid-term，并按视觉能力限制图片。全局周期后 processor 才负责 trim/fold。                                      |
| “长期 memory query 结果自动注入 Replyer”                                         | **[谨慎纠正]** `query_memory` 确实构造 `replyer_memory_reference` metadata，但当前仓库没有找到该 key 的 consumer；可证明的 Replyer handoff 是 Planner 在 `reply` args 中显式传 `reply_reference`。                               |
| “所有 memory 都是每轮稳定注入且跨重启可靠”                                       | **[纠正]** heuristic/profile 是一次性 Planner tail；mid-term summary 是有上限、有裁切、有 embedding recall 的慢路径；自动写回/队列丢弃和外部服务可用性仍需单独验证。                                                             |
| “发送 receipt 已完整回流认知链”                                                  | **[谨慎纠正]** 当前 reply send 成功后可写回 `guided_reply` history，并通知 memory automation；真实平台 accepted/delivered semantics 取决于 adapter/driver，静态源码不能把调用成功等同于平台送达。                                |

## 8. Athena 设计对照（仅限 context assembly）

- **[可借鉴，已实现机制]** MaiBot 的 `ContextItem` role/provenance、tool-call/result closure、per-session serial tool loop、post-cycle trim/fold、replyer explicit reference handoff，适合作为 Athena Chat Mode 的机制参考。
- **[不要照搬，代码推断]** global `personality`/`behavior_style`、session-centric runtime 作为 Life identity、process-global memory/config ownership；这些是应用层共享配置，不是 Life-scoped persona/memory contract。
- **[与 Athena M-32 的直接关系，代码推断]** Athena 要求 absolute timestamp、volatile state at tail、stable frozen frame；MaiBot 当前 current time 在 tail 是正确方向，但 system 仍含 mutable personality/chat attention，且 selected history 会 sliding/fold。不能把 MaiBot 当前 prompt order 宣传为已经满足 Athena 的 append-only frozen-frame 规范。
- **[无法确认]** MaiBot 代码虽有 replay fragment、wire snapshot、cache diagnostics，但未证明它已经拥有 Athena 所说的“每次 LLM 调用冻结 world-state frame entry”；当前可见 history 主要是 session messages/tool/reference objects。

## 9. 最终判断

**[已实现事实]** MaiBot 当前的 context assembly 已是结构化、分 stage、可审计的对象模型：Planner 与 Replyer 明确分离，Action/tool loop 通过 function-call/result history 回流，Replyer 以显式 `reply_reference` 接收 Planner handoff，trim/summary 具有结构保持逻辑。

**[代码推断]** 其最大 cache opportunity 是“固定模板/历史前缀 + 尾部动态 user Items”；其最大 cache risk 是首项 system 中的全局动态 persona/chat policy，以及 context sliding、deferred-tool definitions、retry/image compression。对于 Athena，最值得吸收的是 role/provenance/closure 与尾部 volatility discipline，而不是 MaiBot 的 global persona/session ownership。
