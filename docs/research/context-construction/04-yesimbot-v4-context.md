# YesImBot v4：Append-only、Context Rebuild、Compaction 与 Prompt Cache 证据报告

## 结论先行

**一句话总结：v4 的 durable journal 在正常写入路径上是 append-only，但 LLM context 明确会在每个 model boundary 从 storage 重建并经过 compaction、history projection、`prepareStep` 和 call-scoped media 处理，因此不能准确描述为“上下文严格 append-only、不可重建、已内建 prompt-cache”；稳定 prefix 只在一个未失效的 Agent/ChannelRuntime 生命周期内成立。**

1. **Storage append-only：部分成立。** `AgentStorage` 的正常写入是追加；JSONL 使用 `appendFile`，并由 runtime 的 storage/append pipeline 串行化。可是 `clear()` 会删除内容，Conversation 会通过 archive/switch 创建或切换新 session，compact 会追加一个边界并改变后续 model projection。
2. **Context 不可重建：不成立。** 每次 turn 的 model request 都从 `storage.read()` 重新收集 entries，调用 `transformEntries`、`transformMessages`、`toModelMessages`，再交给 `streamText`；tool-loop 的后续 step 也会重新构造 boundary。
3. **稳定 prefix：有明确边界，但不是全局不变量。** `system`、native tools、provider tools 在 Agent 初始化时冻结；历史 message 在同一 lifecycle 内按 persisted order 追加。但是 Core compact plugin、现有插件的历史 projection，以及若干 `prepareStep` 插件会改变 model-visible request。
4. **Compaction/归档是明确例外。** Compact 只追加 `compact` entry，但 `core.compact-history` 会隐藏最后一个 compact 之前的历史并把摘要转换成 system message；archive/oversize 还会创建新的 active JSONL。摘要是 lossy 的，且压缩失败时 archive 可能切换到空的新 session。
5. **Branch/retry 不存在于 runtime core。** 没有 fork/rebase/branch lineage，也没有 retry metadata；`maxRetries: 0`，失败 turn 不自动重试，但失败前已写入的 submitted/assistant/tool entries 不回滚。
6. **Prompt-cache 没有显式实现。** 当前代码没有 `cache_control`、cache breakpoint、cache key 或 provider-specific prompt-cache lifecycle；只转发已有 `providerOptions`，并累加 SDK 报告的 `cachedInputTokens`。仓库 docs/spec 把 cache lifecycle 作为设计要求，但代码只实现了部分 stable snapshot。
7. **Generic state snapshot 可追加但不会自动恢复。** `AgentStateManager.set/update` 会 append state entry；`resolveInitialState()` 虽然存在，但 `createAgent()` 当前只调用 `createStateManager({ initialState/defaultState })`，没有调用该恢复函数。除非 caller 自己传入 state，重启后的 generic state 默认回到 `{ version: 1 }`（这是 code-based inference）。

> 证据分层：`[CODE]` = 当前 `/home/workspace/YesImBot` 实现；`[SPEC]` = `openspec/specs` 设计约束；`[DOC]` = README/开发日志/愿景；`[INFERENCE]` = 由当前代码推导；`[UNKNOWN]` = 当前仓库无法验证。

## 1. 实际数据流与 owners

```text
ChannelRuntime
  ├─ persist(record)
  │    └─ Agent.append(custom yesimbot.message/event)
  │         └─ Agent append pipeline -> Conversation.storage -> JSONL
  └─ Agent.run(input)
       └─ persistCurrentMessages
       └─ buildBoundaryModelMessages
            ├─ storage.read()
            ├─ transformEntries()
            ├─ transformMessages()
            ├─ toModelMessages()
            └─ extractToolImages()
       └─ streamText({ system, messages, tools, prepareStep, maxRetries: 0 })
```

- `[CODE]` `ChannelRuntime` 在构造时把 `Conversation.storage`、model、provider tools、Core tools、system prompt resolver 与 plugins 交给 `createAgent()`；`core/src/runtimes/channel.ts:39-65`。
- `[CODE]` 普通 record 先转为 `yesimbot.message/event`，再 `agent.append()`，并在 Will 判断前 emit；`core/src/runtimes/channel.ts:149-176,222-226`。
- `[CODE]` Agent storage facade 将 `append/read/clear` 串到 `storageReady`，append entries 还经过单独的 `appendPipelineReady`；`packages/agent-runtime/src/agent.ts:74-118,144-178`。
- `[CODE]` Channel Conversation 对外暴露的是当前 JSONL storage facade；`core/src/conversations/index.ts:53-72`。

## 2. “严格 append-only”到底成立到哪一层

| 层                  | 当前行为                                                                 | 判断                                              |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------------- |
| AgentEntry 正常写入 | JSONL `appendFile`；memory storage `push`；runtime storage mutation 串行 | **成立（正常追加路径）**                          |
| Append pre-commit   | `onAppend` 可返回 transformed entries，原 pending entry 不一定原样落盘   | **不是原始输入不可变，而是提交后 journal 不回写** |
| Model context       | 每个 boundary 读 storage 并重新 projection                               | **不成立为严格 append-only**                      |
| State               | 每次 `set/update` 追加 state snapshot                                    | **追加式，但不是自动恢复式**                      |
| Clear/reset         | `clear()` 删除 JSONL；Core reset 删除 `sessions/` 和 assets/artifacts    | **明确破坏 append-only**                          |
| Archive/switch      | 旧文件保留，创建/切换新 active 文件                                      | **历史不改写，但 active context 发生切换**        |

- `[CODE]` `AgentStorage` 只有 `append/read/clear`；memory storage 的 `clear` 清空数组，JSONL storage 的 `clear` 用 `rm(filePath)` 删除文件，JSONL append 用 `appendFile`；`packages/agent-runtime/src/storage.ts:5-57`。
- `[CODE]` `AgentEntry` 有 `id/type/data/timestamp/parentId`；`parentId` 只是 entry-tree 元数据，当前 turn 没有写入它；`packages/agent-runtime/src/entry.ts:5-40`。
- `[SPEC]` `agent-storage-session` 要求 append-only entry model、独立 entry/message id 与 runtime write ordering；`openspec/specs/agent-storage-session/spec.md:23-25,72-78,176-178`。
- `[CODE]` Core reset 停止 runtime、删除整个 `sessions` 目录及 assets/artifacts，然后移除 channel cache；`core/src/channels/index.ts:112-121`。因此“系统任何情况下绝不删除/重置历史”不是当前事实。

## 3. Context 会被显式重建：关键代码路径

- `[CODE]` `collectHistoryMessageEntries()` 每次调用都等待 append pipeline、`storage.read()`，然后执行 `pluginHost.helpers.transformEntries(rawEntries)`，最后筛选 message entries；`packages/agent-runtime/src/agent.ts:292-297`。
- `[CODE]` `buildBoundaryModelMessages()` 把 persisted entries 与当前 entries 按 entry id 去重，分别作为 history/current，再调用 `buildModelMessages()`；`packages/agent-runtime/src/agent.ts:335-342`。
- `[CODE]` `buildModelMessages()` 先对 history 调 `transformMessages`，再逐条经 `toModelMessages` 或 plain-role conversion，最后调用 `extractToolImages`；`packages/agent-runtime/src/message.ts:77-104`。
- `[CODE]` `streamText()` 的初始 request 使用当前重建出的 `modelMessages`；后续 step 在 `stepNumber > 0` 时 drain joined input，若无 joined input 再次调用 `buildBoundaryModelMessages()`；`packages/agent-runtime/src/agent.ts:402-443`。
- `[CODE]` `prepareStep` 在每个 step 都能返回一份新的 message array，结果作为该 step 的 `messages` 传入 SDK；`packages/agent-runtime/src/agent.ts:422-443`。

因此“只在尾部 append，不会 rebuild”与代码相反。更准确的描述是：**persisted journal 保持 append order；model request 是从 journal 反复 materialize 的 projection。**

### 3.1 历史 projection 的现有例外

- `[CODE]` Core 的 `COMPACT_HISTORY_PLUGIN` 找最后一个 `compact`，直接 `entries.slice(lastCompactIndex)`，并把 compact entry 转成 `<conversation_memory>` system message；`core/src/runtimes/channel.ts:47-60`。这会从 model-visible history 中移除 compact 前的旧 messages，虽然物理 JSONL 仍然保留。
- `[CODE]` Plugin API 允许 `transformEntries`、deprecated `transformMessages`、`toModelMessages`、`prepareStep`；`transformMessages` 明确标记 deprecated，但 `buildModelMessages` 仍会在每个 boundary 执行它；`packages/agent-runtime/src/plugin.ts:27-40`、`packages/agent-runtime/src/message.ts:82-89`。
- `[CODE]` OneBot plugin 对 append entries 与历史 entries 都调用 animated-image projection；`plugins/onebot-utils/src/index.ts:91-96`。Sticker plugin 对 append entries 与历史 entries 分别解析/替换 sticker/artifact；`plugins/sticker-manager/src/index.ts:71-88`。这些都是 persisted raw content 之外的 model-visible projection。
- `[CODE]` Sticker historical projection 会查询当前 `StickerStore`/`ArtifactStore` 并可能返回不同 image/sticker element 或丢弃无法解析的元素；`plugins/sticker-manager/src/sticker-element.ts:37-66,99-137`。这使“同一历史永远 byte-equivalent”只在没有这些 projection 变化时成立。

## 4. Compaction、summary、archive：物理追加与语义替换并存

### 4.1 Compact 本身是 append，但 summary 是 lossy projection

- `[CODE]` `Conversation.compact()` 只取最后一个 compact 之后的 entries；消息数不足、输入为空或 failure 会返回不 compact；成功后调用 `executeCompact()`，创建并 append 一个 `compact` entry，更新内存 summary 与 failure counter；`core/src/conversations/index.ts:139-171`。
- `[CODE]` 压缩输入 `filterEntriesForCompression()` 跳过所有 `tool` role，只保留特定 `yesimbot.message`/`yesimbot.event` 与 assistant text；`core/src/conversations/compact.ts:5-22`。因此旧 tool call/result 可能仍在 JSONL，却不再进入 compact summary 的输入，也会在 Core compact projection 后从 model context 消失。
- `[CODE]` Summary 被 trim 到 30,000 chars；空 summary、模型 failure、连续 failure limit 都有独立结果；`core/src/conversations/index.ts:149-178`、`core/src/conversations/compact.ts:25-41`。
- `[CODE]` `Conversation.memory` 在 `init/switch` 时从最新 compact entry 恢复；`core/src/conversations/index.ts:225-229`。这是 compact memory 的恢复，不是 generic Agent state 的恢复。

### 4.2 Archive/oversize 会切换 active file

- `[CODE]` 成功 compact 后 archive 会创建新 session，并只把最新 compact entry 写入新 active file；无 summary archive 会创建空新 session；`core/src/conversations/index.ts:111-123`。
- `[CODE]` oversize 时若已有 compact，直接用该 compact seed 新 session；否则调用 `archive(!input, input)`；`core/src/conversations/index.ts:125-135`。
- `[CODE]` 这不是 destructive overwrite：旧 JSONL 文件仍列在 sessions 中；但 active Agent 后续读取的是新文件，因此 model-visible prefix 发生切换。
- `[CODE]` archive compact 失败时仍会落到创建 blank destination；现有测试明确覆盖“falls back to blank session when compact fails during archive”；`core/tests/conversations.test.ts:55-82`、`core/tests/conversations.test.ts:153-174`。这会造成后续 active context 暂时看不到旧 history，旧内容只能通过 archived session/switch 找回。

### 4.3 与 cache lifecycle spec 的差异

- `[SPEC]` 历史 compaction 改写 model projection 时，必须结束旧 cache lifecycle，不能把新 request 当作旧 prefix 的 continuation；`openspec/specs/system-prompt-composition/spec.md:66-81`。
- `[CODE]` `ChannelRuntime.compact()` 只是 append compact 后调用 `archiveIfOversize()`；若未超 size，仍使用同一个 Agent/ChannelRuntime；`core/src/runtimes/channel.ts:198-207`。下一次 request 由同一 Agent 的 `COMPACT_HISTORY_PLUGIN` 改写 projection，没有 generation/lifecycle id，也没有主动 replacement。
- `[INFERENCE]` 因而 provider 若以“runtime instance = cache lifecycle”理解，compact 后可能把语义上重写的 history 当成同一 runtime 的 continuation；至少代码没有显式阻止这种误报或主动 cache reset。

## 5. Tool history、active-turn observation 与 model request

### 5.1 Tool loop 的 append order

- `[CODE]` 每个 step 完成时，runtime 取 `step.response.messages.slice(persistedResponseMessageCount)`，将 assistant response 转为 assistant message、其余转为 tool message，再通过 append pipeline 写入；`packages/agent-runtime/src/agent.ts:451-474`。
- `[CODE]` `persistedResponseMessageCount` 防止 AI SDK cumulative response snapshot 重复写入旧 assistant/tool messages；同一段代码还合并 usage。
- `[CODE]` tool 执行包装器以 `serial` promise 链串行执行，并把 turnId、toolCallId、state、storage、当前 messages 和 abort signal 传入 tool；`packages/agent-runtime/src/agent.ts:187-266`。
- `[CODE]` model request 会把已有 assistant tool-call 与 matching tool-result 作为普通 persisted history；测试覆盖 normalized tool messages、cumulative deduplication 和 joined input order；`packages/agent-runtime/tests/append.test.ts:432-530`。

### 5.2 Active-turn append 与 join 的区别

- `[CODE]` `append(message)` 只 append，不创建 top-level turn；active turn 下一 safe boundary 会从 storage rebuild 并看见它。`send(message,{ifBusy:"join"})` 则作为 explicit joined input，在 boundary drain 后追加；`packages/agent-runtime/src/agent.ts:535-582`、`packages/agent-runtime/src/agent.ts:335-342,422-443`。
- `[CODE]` append order 不按 message timestamp 重排；测试覆盖“active turn appends visible at next model boundary”与“joined input remains explicit”；`packages/agent-runtime/tests/append.test.ts:386-430,543-593`。
- `[SPEC]` active-turn observation visibility 与 append order 是明确要求；`openspec/specs/agent-runtime-core/spec.md:364-385`。

### 5.3 Tool-result image 是 call-scoped 例外

- `[CODE]` `extractToolImages()` 从 tool-result 中移除 image-data/image-url，把非图片 tool result 保留，并在后面生成一个新的 user message 携带 image parts；该 user message 没有写回 AgentStorage；`packages/agent-runtime/src/message.ts:124-151`。
- `[INFERENCE]` 因而“tool result 的文字/结构在 persisted history 中稳定”成立，但模型每次 request 看到的 image user message 是 projection-time generated content，不是 durable append entry；这正是允许 call-scoped media variation 的例外，而不是严格 append-only message。

## 6. Branching、retry、interrupt 与失败历史

- `[SPEC]` branch/fork/checkout/rebase 在 first-version session behavior 中明确 out of scope；`openspec/specs/agent-storage-session/spec.md:134-146`。
- `[CODE]` `AgentEntry.parentId` 没有被 runtime 用来关联 turn；没有 `retryOf`、parentTurnId 或 branch id；`packages/agent-runtime/src/entry.ts:5-20`。
- `[CODE]` busy 策略只有 `defer | join | reject`：defer 新建 queued turn，join 复用 active turn，reject 在 append 前抛 busy error；`packages/agent-runtime/src/turn.ts:74-137`、`core/src/runtimes/channel.ts:273-282`。
- `[CODE]` AI SDK request 显式 `maxRetries: 0`；turn failure/abort 会 append abnormal terminal event，但不会 rollback 已写 entries；`packages/agent-runtime/src/agent.ts:402-463,492-522`。
- `[SPEC]` retry 必须在 core 外部实现，失败 attempt settle 后不得自动创建 retry turn；`openspec/specs/agent-runtime-core/spec.md:324-336`。
- `[CODE]` 失败测试验证 model 只调用一次并只持久化 abnormal terminal event；`packages/agent-runtime/tests/turn.test.ts:240-263`。
- `[CODE]` `Conversation.switch(id)` 可切换已有 JSONL，`archive()` 创建新文件；这提供 session selection/linear archive，而不是 branch/fork/rebase lineage；`core/src/conversations/index.ts:95-123`。

**失败模式：** 如果 host 自己重新 `send()` 一次，它会得到一个新 turn，但当前 core 没有自动把新 turn 与旧失败 attempt 关联；retry provenance 只能由 caller-owned custom entry/event 或外部 store 记录（[INFERENCE]）。

## 7. State update、runtime snapshot 与外部动态 context

### 7.1 Generic Agent state

- `[CODE]` `AgentStateManager.set/update` 更新内存 current，并 append 一个 `state` entry；`packages/agent-runtime/src/state.ts:10-34`。
- `[CODE]` `resolveInitialState()` 能从 storage 逆序读取最新 state entry，但 `createAgent()` 当前只在 `packages/agent-runtime/src/agent.ts:93` 调用 `createStateManager({ storage, initialState: ... })`，仓库内没有把 `resolveInitialState()` 接入 agent init 的 callsite；`packages/agent-runtime/src/state.ts:36-48`。
- `[INFERENCE]` 因此 generic state snapshot “可持久化”不等于“重启自动恢复”；需要 caller 在创建 Agent 时显式读取并传入 `initialState`，否则默认 `{version:1}`。

### 7.2 Runtime stable snapshots

- `[CODE]` Agent init 一次 resolve system prompt、初始化 plugin host，然后冻结 `frozenSystemPrompt`、`frozenTools`、`frozenProviderTools`；`packages/agent-runtime/src/agent.ts:170-224`。
- `[CODE]` Core `buildCoreSystemPrompt()` 每个 runtime init 读取 Constitution、persona、可选 `AGENTS.md` 与 runtime context，并按固定顺序返回 system blocks；`core/src/runtimes/prompt.ts:38-55`。
- `[CODE]` Runtimes 对 shared channel 在 Bot selfId 不变时复用 runtime；selfId 变化时 stop 旧 runtime、重新 resolve model/compact/vision/plugins 并创建 replacement；direct channel 则按现有条件复用；`core/src/runtimes/index.ts:28-74`。
- `[DOC]` 开发日志将此称为“冻结 prompt/tools/model/provider/plugin，使 provider prompt cache 可维护”；`docs/athena-development-log.md:269-272`。
- `[CODE/SPEC mismatch]` 当前 public `Agent` 仍暴露 `setModel()` 并直接修改闭包中的 `model`；`packages/agent-runtime/src/agent.ts:49-65,575-581`。但 spec 要求 public Agent 不得暴露 `setModel/setTools` 且模型/工具直到 Agent stop 保持固定；`openspec/specs/agent-runtime-core/spec.md:96-101`。插件 runtime 也保留 `setModel()`；`packages/agent-runtime/src/plugin.ts:20-25`。这是一条可破坏 stable cache lifecycle 的实际 seam，尽管内置 quota 目前只在 plugin `init` 中使用它；`plugins/quota/src/index.ts:370-375`。

### 7.3 Dynamic plugins 并非都 append snapshot

- `[CODE]` `global-brain.prepareStep` 读取当前 digest，并将 `[全局脑摘要]` 作为新的 user message 追加到本次 request；它只按 `turnId` 注入一次，不把 digest 写入 Agent history；`plugins/global-brain/src/index.ts:96-106`。
- `[CODE]` `chat-learning.prepareStep` 在 turn 首次 step 可能异步 rebuild 外部 state，然后把 style/reflection block 作为 system 或 user message 追加；`plugins/chat-learning/src/index.ts:402-462`。其 `onAppend` 还会改写将要持久化的 assistant entries；`plugins/chat-learning/src/index.ts:402-423`。
- `[CODE]` roleplay 将 character definition 放在 messages 前、post-history instructions 放在 messages 后，而不是都作为 stable `system` blocks；`plugins/roleplay/src/roleplay.ts:30-39`。
- `[CODE]` onebot/sticker 的 `transformEntries` 在 history rebuild 时可重投影 message content/elements；见 §3.1。
- `[SPEC]` 设计要求 per-turn memory/state/environment/current events 通过 append-only messages/tool results 进入 context，不应在历史之前每次重生 changing system segments；`openspec/specs/system-prompt-composition/spec.md:48-64`。
- `[INFERENCE]` 现有 dynamic plugins 证明“所有动态 context 均已 append/persist、可重放”并不成立；它们有自己的 external stores 和 in-memory turn guards，后续 Agent turn 可能看到新 snapshot，但 Agent journal 中没有对应 immutable snapshot entry。

## 8. Prompt-cache integration：文档承诺与代码现实

### 已实现的部分（[CODE]）

- stable system prompt 在 Agent init 时 resolve once；`packages/agent-runtime/src/agent.ts:170-224`。
- stable tools/provider tools 在 init 时固定并按 deterministic plugin order 合并；同处代码。
- persisted history 在没有 projection/lifecycle 变化时按 storage order 作为 prefix，new current messages/tool outputs 追加到尾部；`packages/agent-runtime/src/agent.ts:335-342,402-474`。
- assistant/tool message 上的 `providerOptions` 会被投影回 plain model message；`packages/agent-runtime/src/message.ts:179-197`。
- usage merge 会累加 `cachedInputTokens`；`packages/agent-runtime/src/agent.ts:630-639`。

### 未实现或不完整的部分

- `[CODE]` `streamText()` 调用只提供 `system/messages/tools/stopWhen/abortSignal/prepareStep/maxRetries`，没有 cache key、cache breakpoint、`cache_control` 或 cache-generation id；`packages/agent-runtime/src/agent.ts:402-448`。
- `[CODE]` Provider adapters 主要注册 SDK model、tools 与 DeepSeek reasoning `providerOptions`，没有仓库级 prompt-cache adapter；例如 `providers/deepseek/src/index.ts:76-83`。Core usage middleware 只上报 SDK usage，不建立 cache lifecycle；`core/src/models/index.ts:445-472`。
- `[DOC/SPEC]` OpenSpec 要求 stable prompt/cache lifecycle、显式 invalidation、compact 后新 lifecycle 与 cache-preserving historical projection；`openspec/specs/system-prompt-composition/spec.md:31-81`。
- `[CODE mismatch]` compact 后同一 ChannelRuntime 继续用 `COMPACT_HISTORY_PLUGIN` 重写 projection，没有显式 replacement；见 §4.3。
- `[UNKNOWN]` provider SDK 可能在 HTTP/provider 内部自动做隐式 prompt caching，但仅凭本仓库无法确认命中条件、cache key、失效规则或是否把 `cachedInputTokens` 作为真实 cache hit 反馈。因此不能把“SDK 可能自动缓存”写成 YesImBot 已集成 prompt-cache。

## 9. 七类目标场景适配度

仓库没有找到一份明确命名为“七个 target scenarios”的当前清单；以下七项是根据本 assignment 的机制关键词归纳的 scenario probes，属于 `[INFERENCE]`，并给出对当前代码的适配判断。

| #   | Scenario probe                                                                       | 当前代码                                                                                                                                                                                                                                                                                                                                      | 适配度                                                                                                                                      |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Ordinary observation / wait**：群消息被记录但不触发回复                            | `ChannelRuntime.handle()` 先 append/emit，再由 Will 决定 `wait`；`append()` 本身不启动 model turn；`core/src/runtimes/channel.ts:149-176`、`packages/agent-runtime/src/agent.ts:535-546`                                                                                                                                                      | **适合**。这是当前 message-first 设计的强项。                                                                                               |
| 2   | **Active-turn append observation**：Agent 思考/tool 期间新观察进入下一 safe boundary | storage append 后下一 boundary rebuild；不会强制新 top-level turn；测试 `packages/agent-runtime/tests/append.test.ts:386-430`                                                                                                                                                                                                                 | **适合**。append order 保留，但它依赖“可重建 context”，不是不可重建。                                                                       |
| 3   | **Busy explicit input**：`defer/join/reject`                                         | turn queue 与 ChannelRuntime 分别实现三种语义；`packages/agent-runtime/src/turn.ts:74-137`、`core/src/runtimes/channel.ts:273-282`                                                                                                                                                                                                            | **适合**。join 是 explicit current input，ordinary append 仍是 history observation。                                                        |
| 4   | **Tool loop / tool history**：assistant tool-call、tool-result、下一 step            | step boundary append + cumulative dedup；tool serial execution；测试 `packages/agent-runtime/tests/append.test.ts:432-530`                                                                                                                                                                                                                    | **适合但有例外**。文字/结构化 tool history 稳定；tool images 通过未持久化 user message 生成，属于 call-scoped projection。                  |
| 5   | **Model/tool failure、interrupt、retry**                                             | failed/aborted terminal event append，partial history 不回滚，`maxRetries:0`；branch/retry lineage 不存在；`packages/agent-runtime/src/agent.ts:492-522`                                                                                                                                                                                      | **适合“无自动 retry”**；**不适合需要可追溯 retry/branch**。外部 host 必须自己记录关联。                                                     |
| 6   | **Compaction/archive 与 cache-prefix continuity**                                    | compact entry append；后续 history projection 隐藏旧前缀；archive 可 seed summary 或 blank new session；`core/src/conversations/index.ts:111-171`、`core/src/runtimes/channel.ts:47-60`                                                                                                                                                       | **适合会话长度控制**；**不适合宣称旧 cache prefix 无缝延续**。代码没有 compact-triggered lifecycle replacement，摘要还会丢失 tool history。 |
| 7   | **State/world snapshot、memory retrieval、动态环境**                                 | state update 是 append snapshot，但 generic state 不自动 restore；global-brain/chat-learning 主要在 `prepareStep` 动态注入且不持久 snapshot；vision docs 明确 world state 不是当前 Core 能力；`packages/agent-runtime/src/state.ts:17-48`、`plugins/global-brain/src/index.ts:96-106`、`docs/athena-v4-vision-and-evolution-notes.md:172-182` | **部分适合**。外部 plugin/domain 可维护自己的 state；当前 Core 不足以证明通用、可重放、append-only world-state context。                    |

## 10. Failure-mode analysis

1. **Compaction causes semantic prefix replacement without lifecycle boundary.** 旧 entries 仍在磁盘，但 model projection 从最后 compact 起重建；若 provider cache 只按 runtime identity 判断，会出现 stale/misreported prefix（[INFERENCE]）。
2. **Compaction is lossy and tool-blind.** `filterEntriesForCompression()` 明确跳过 tool messages；tool-derived facts 只有在 user/assistant summary 中被保留时才会继续可见。
3. **Archive compact failure can activate blank session.** 旧文件没有被删除，但默认 active request 看不到旧历史，直到 operator switch archived session；`core/tests/conversations.test.ts:153-174`。
4. **Projection drift from external stores.** Sticker/artifact and other `transformEntries` may resolve current external state during every rebuild, so persisted message bytes and current model-visible bytes are not equivalent.
5. **Non-persisted dynamic injections break replayability.** `global-brain` digest and `chat-learning` style/reflection blocks enter through `prepareStep` but are not Agent entries; replaying the same journal later may produce a different request.
6. **Generic state persistence has a restore gap.** `resolveInitialState()` is dead from current `createAgent()` path; a restart may lose state despite state entries existing.
7. **Mutable model seam contradicts stable cache design.** Public `Agent.setModel()` and plugin runtime `setModel()` remain callable even though the spec says model must remain fixed until stop.
8. **Clear/reset is destructive.** Any statement that the v4 journal is unconditionally append-only must explicitly exclude `Agent.clear()`, `Conversation` reset, and Core channel reset.
9. **Retry provenance is absent.** A host-level retry is a new linear turn; there is no built-in parent attempt/retry id, so audit/causal reconstruction requires external custom entries/events.
10. **Provider cache behavior is not owned by Core.** `cachedInputTokens` is accounting, not proof of stable-prefix cache policy; actual SDK/provider cache behavior remains `[UNKNOWN]`.

## 11. Corrected v4 description

> YesImBot v4 uses an append-ordered AgentEntry/JSONL journal for accepted observations, submitted messages, step-complete assistant/tool messages, selected abnormal events, compact boundaries, and state snapshots. The journal is durable and normally never edits an existing entry, but it can be cleared, archived, switched, or replaced by a new active session. LLM requests are not immutable views of that journal: each model boundary rebuilds a projection from storage, applies compact/history/custom-message/media/plugin transforms, then appends current turn material at the tail. Stable system prompt, tools, model, and plugin resources are frozen only for one Agent/ChannelRuntime lifecycle; compaction and any historical projection change should be treated as a new cache lifecycle by design, but current code does not consistently perform that replacement. Runtime core intentionally has no branch/fork/rebase or automatic retry; failed/aborted turns preserve already-written partial history and require external retry association. Prompt-cache integration is currently an architectural goal plus SDK usage accounting, not an explicit provider-neutral cache-control implementation.

## 12. Unknowns and scope boundaries

- `[UNKNOWN]` No external provider SDK internals were treated as current YesImBot behavior; provider-side automatic caching cannot be confirmed from this repository.
- `[INFERENCE]` The seven probes above are a task-oriented mapping because no current source file exposed an authoritative seven-scenario list.
- `[DOC]` Current vision explicitly says world state, proactive behavior and learning-style WillEngine are deferred/non-Core requirements; `docs/athena-v4-vision-and-evolution-notes.md:172-182`。不要把 archived OpenSpec designs for future GlobalAgent/WorldEngine 当作 current v4 implementation evidence.
