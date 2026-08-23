# Athena Context Construction Research (§A / §B)

## 一句话总结

**高置信证据共同指向：context 不是“全量 append”或“每次全量 rebuild”的二选一，而是持久化历史、每请求投影、外部/长期 memory、可变 world-state 与 cacheable prefix 的分层系统；context rot、TTL、工具结果和状态新鲜度都要求按信息性质做选择，而不是用一个全局规则。**

## 0. 范围、权威与证据等级

- 本报告只覆盖 §A / §B 所需的 context rot、cache-prefix constraints、compaction、state freshness、long-horizon agents、memory vs. chat history、tool-result handling、rebuild-versus-append。
- 用户指定的七个 URL 已按原样核验；其中部分页面当前不可访问。**不可访问不等于内容不存在**，但不能把搜索摘要、转载或记忆当成一手证据。
- 证据等级：
  - **High**：给定 URL 当前可直接读取，且页面本身给出日期/方法/明确机制。
  - **Medium**：一手 URL 可被搜索索引，但直接抓取超时；或为官方补充文档的搜索摘要。
  - **Low / Unverifiable**：只有二手摘要、转载或搜索片段，无法核验原文。
  - **Inaccessible**：当前 URL 返回 404、X bot block 或 TLS/抓取错误。
- Athena 的七个场景采用 `.specify/specs/capability-protocol-and-entity-model.md` 的 User Story 1–7 作为**历史场景清单**；该 spec 明确标为 **SUPERSEDED**，因此这里只借用场景名称，不能把其中旧的 pull-based 细节当作现行设计。现行 `perception-protocol-and-session-design.md` 与当前代码优先。

## 1. 七个指定 URL 的核验矩阵

| #   | 指定来源                                                                                                                                                                                              | 当前核验结果 / publication claim                                                                                                                                             | 可安全使用的证据                                                                                                                                            | 置信度                                                           |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | [X / free_ai_guides article](https://x.com/free_ai_guides/article/2082463119742320825)                                                                                                                | X 页面被 reader 明确标为 `twitter-blocked`；Nitter 不可用。另一抓取路径还出现 TLS certificate error。标题、作者、日期、正文均无法核验。                                      | 只能确认“当前不可访问”；不能引用其具体论点。                                                                                                                | **Inaccessible**                                                 |
| 2   | [Claude — The new rules of context engineering for Claude 5 generation models](https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models)                           | 直接抓取超时。搜索索引能看到该一手 URL 与标题；二手索引称约 2026-07-24/25 发布，但原页面日期未直接核验。当前日期下它不是未来日期，但其“Claude 5”时代定位相对 2025 文档较新。 | 搜索摘要提示：减少 rigid prompt rules、progressive disclosure、tool interface、auto-memory、CLAUDE.md 静态知识、减少冗余计划文件；这些只能作为待核实线索。  | **Medium for existence; Low for claims**                         |
| 3   | [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)                                                          | 直接可读，页面写明 **Published Sep 29, 2025**。                                                                                                                              | context engineering 定义、context rot、JIT retrieval、hybrid retrieval、compaction、structured note-taking、sub-agent architectures、tool-result clearing。 | **High**                                                         |
| 4   | [Chroma — Context Rot: How Increasing Input Tokens Impacts LLM Performance](https://www.trychroma.com/research/context-rot)                                                                           | 直接可读，页面写明 **Chroma Technical Report, July 14, 2025**。报告作者 Kelly Hong、Anton Troynikov、Jeff Huber；评估 18 个模型。                                            | 受控 long-context 实验、任务/干扰项/相似度/海栈结构的结果与限制。                                                                                           | **High**                                                         |
| 5   | [Manus — Context Engineering for AI Agents: Lessons from Building Manus](https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus)                                         | 指定 URL 当前返回 `https://manus.im/404` / HTTP 404。搜索可见标题与大量二手复述，但无法从 Manus 原页核验正文和发布日期。                                                     | 只能把 KV-cache、filesystem offload、tool masking、recitation、sub-agent isolation 等列为**二手线索**，不可称 Manus 一手已证实。                            | **Inaccessible; Low for claims**                                 |
| 6   | [OpenAI — Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq)                                                                                                                         | 直接可读；页面显示 **Updated: 8 days ago**（动态更新时间，不宜当作永久 publication date）。                                                                                  | ChatGPT memory summary、memory 与 chat history 分离、删除/关闭/Temporary Chat 的边界。                                                                      | **High for ChatGPT product behavior; not an agent-runtime spec** |
| 7   | [Claude Support — Use Claude’s chat search and memory to build on previous context](https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context) | 直接抓取超时；搜索摘要可见该 URL，但正文、更新时间、精确语义未核验。                                                                                                         | 只能确认该官方帮助页存在；“chat search + memory” 的具体组合行为不可作高置信引用。                                                                           | **Medium for existence; Low for claims**                         |

### 1.1 补充的一手 cache 机制核验（非七个指定 URL）

为判断 §A/§B 的 cache mechanics/TTL，搜索到官方 [Claude Prompt Caching docs](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching) 的明确摘要：cache breakpoint 标记请求中最后一个 cacheable block，并会随会话增长自动前移；TTL 到期、prefix 变化、插入不可缓存 block、TTL 顺序错误都会使 cache miss。该页面直接抓取也超时，因此标为 **Medium（官方搜索摘要）**，不作价格结论。此补充只用于 cache 机械语义，不扩展到 OpenAI/其他 provider。

## 2. Claim / evidence table

| 主题                                                            | 一手 claim / observation                                                                                                                                                                                                                                                                        | 对 Athena §A / §B 的可用解释                                                                                                                                                                                                                                         | 证据与置信度                                                                                                                   |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Context rot 不是 hard cliff**                                 | Anthropic 观察到模型在 context 变长后会 lose focus/confusion，并把 context 视为有 diminishing marginal returns 的有限资源；它描述的是 performance gradient，而不是某个固定 token 数的断崖。Chroma 在 18 个模型、固定任务复杂度而只改变 input length 的实验中，发现 performance 随长度普遍下降。 | 不应把“窗口内”视为“可靠可用”；也不应把一个固定 token threshold 当普适答案。预算、相关性、干扰项与任务结构都要进入评估。                                                                                                                                              | Anthropic 2025-09-29；Chroma 2025-07-14。**High**                                                                              |
| **长 context 的退化取决于内容，不只取决于 token count**         | Chroma 报告：needle-question similarity 越低，随长度的退化越快；distractors 的影响非均匀且随长度放大；haystack 的结构也影响处理；needle-haystack similarity 没有 uniform effect。                                                                                                               | §A 的 context builder 应保留 provenance/类型/场景边界，不能只做“取最近 N 条”或只按总 token 数裁剪。相同长度的 stale state、相关 distractor、工具噪声不是等价成本。                                                                                                   | Chroma controlled experiments。**High，但外推到生产 agent 属于 inference**                                                     |
| **Per-request curation 是 context engineering 的核心**          | Anthropic 明确定义 context engineering 为每次 inference 对 system instructions、tools、MCP、external data、message history 等 token 的持续 curation；不是一次写好 prompt 后永远 append。                                                                                                        | 支持“持久历史 + 每请求 rebuild projection”的方向，但不证明所有内容都应每次重渲染；稳定部分可保持原样，易变部分应重新取值。                                                                                                                                           | Anthropic “Context engineering vs. prompt engineering”。**High**                                                               |
| **JIT retrieval 解决新鲜度与污染的张力**                        | Anthropic 建议保存轻量 identifiers（file paths、stored queries、web links），运行时用 tools 加载需要的数据；Claude Code 采用 upfront `CLAUDE.md` + glob/grep JIT 的 hybrid，以绕开 stale indexing。runtime exploration 更慢，但可避免预先加载整个 corpus。                                      | world-state 不应把易变派生状态冻结在长期 prefix；可保留稳定身份/规则，按 request 从 authoritative state 生成尾部 snapshot。静态/低变化资料可 upfront，动态资料 JIT。                                                                                                 | Anthropic “Context retrieval and agentic search”。**High**                                                                     |
| **Compaction 是有损但可调的 context reset**                     | Anthropic：接近窗口限制时把 history 摘要并重新开启 context；保留 architectural decisions、unresolved bugs、implementation details，并丢弃重复 tool outputs/messages；过度 compaction 可能丢失稍后才显重要的细节。                                                                               | compaction 不是“删除历史”同义词，而是从 full history 生成新的 projection/checkpoint；要区分 durable record、summary、当前帧和可回放原始资料。                                                                                                                        | Anthropic “Context engineering for long-horizon tasks”. **High**                                                               |
| **Tool-result clearing 是轻量 compaction，不是无条件清空**      | Anthropic 把清理深层 history 的 tool calls/results 称为一种 safest/lightest-touch compaction，但同时要求压缩 prompt 高 recall，避免丢失后续需要的细节。                                                                                                                                         | tool result 可按层次处理：原始大输出可外存/清除，关键结论、error、receipt、状态变化需保留；“永远保留”与“全部清掉”都过强。现行 Athena spec 要求被打断时已执行 tool result 完整进入 transcript（`.specify/specs/perception-protocol-and-session-design.md:493–496`）。 | Anthropic + current Athena design. **High for mechanics; policy choice is inference**                                          |
| **Structured note-taking / external memory 跨越 context reset** | Anthropic：agent 定期写 notes 到 context 外，后续再拉回；Claude Code 的 todo/`NOTES.md` 让多小时任务在 reset 后恢复目标、依赖和进度。                                                                                                                                                           | long-horizon state 不应只存在 chat transcript；需要可更新的 durable state/notes，并在每 request 选择性注入。它与 chat history 是互补，不是同一层。                                                                                                                   | Anthropic “Structured note-taking”. **High**                                                                                   |
| **Sub-agent isolation 是另一种 context control**                | Anthropic：focused sub-agent 使用干净窗口深入搜索/工具操作，lead agent 只收 1,000–2,000 token 左右 distilled summary；适合复杂 research，compaction 更适合连续 back-and-forth。                                                                                                                 | “单一全局 transcript”不是所有场景的必要条件；但是否拆 sub-agent 取决于任务结构与协调成本，不能由 context rot 单独推出。                                                                                                                                              | Anthropic “Sub-agent architectures”. **High**                                                                                  |
| **Stable cache prefix 与 volatile suffix 应分开**               | 官方 Claude Prompt Caching 摘要显示 cache breakpoint 针对最后一个 cacheable block，prefix 改变或 TTL 到期即 miss；Anthropic context article 的 JIT/hybrid 论据也支持把动态资料放在可重建区域。Manus 的“KV-cache hit-rate/stable prefix”线索来自二手摘要，原页 404，不能当一手证据。             | 影响 §A：稳定 system/persona/tool schema 可以成为 prefix；world snapshot、当前时间、最新 perception、工具结果等易变信息不要污染 prefix。cache hit 不是“整个 prompt 永久缓存”，而是对满足 provider 规则的 prefix 片段缓存。                                           | Claude official docs search summary **Medium**；Manus claim **Low/unverifiable**；Athena M-32 为 documented design（未实现）。 |
| **TTL 是 cache freshness 约束，不是 state freshness 机制**      | Claude 官方摘要：TTL 到期会 break cache；streaming time 也消耗 TTL；prefix/insertion/order 变化同样会 miss。TTL 只说明缓存可复用多久，不代表 cached world state 仍然正确。                                                                                                                      | §B 应把“缓存可复用”与“状态是否 authoritative/current”分开建模。动态 state 可以每 request 新取，同时复用稳定 prefix；不能用 cache hit 推断 world snapshot 新鲜。                                                                                                      | Official Claude docs search summary **Medium**；state distinction is code-based inference.                                     |
| **Memory 与 chat history 不是同一物**                           | OpenAI Memory FAQ 明确：memory summary 是自动更新的 synthesis，不包含记住的全部内容；saved-memory notepad 与 chat history 分开存放；删除 chat 不一定删除 memory；关闭 memory 不删除历史；Temporary Chat 不使用/创建 memory。                                                                    | 长期 memory 是独立、可编辑、可删除、可能滞后的 state layer；chat transcript 是事件/对话记录。不能把“写进 history”自动等价为“形成正确 memory”，也不能假定删一个就删另一个。                                                                                           | OpenAI product docs。**High，限 ChatGPT 产品语义**                                                                             |
| **Claude chat search + memory 的具体边界待核验**                | 指定 Claude support URL 当前超时；搜索摘要只显示“chat search and memory to build on previous context”主题，无法核验是否自动总结、何时召回、删除语义和 freshness。                                                                                                                               | 可把“search / memory / current chat”视作可能的三层概念，但不能从该页推导 Athena 的 persistence contract。                                                                                                                                                            | 指定 support URL。**Low/unverifiable**                                                                                         |
| **Manus 的 offload/masking/recitation 不能当已验证一手事实**    | 指定 Manus URL 当前 404。搜索及转载常见说法包括 browser/search 大结果写入 filesystem，只把 ref 留在 context；unused tools masking 保持 prefix；todo/recitation 防止目标漂移；保留 failure/stack trace 促进修正。                                                                                | 这些模式与 Anthropic 的 JIT/notes/compaction 一致，可作为待核实设计线索；但报告必须标注“secondary/unverifiable”，不能说 Manus 已证明某具体收益或命中率。                                                                                                             | URL 404 + secondary search snippets。**Low**                                                                                   |

## 3. §A：Per-request rebuild、append-only history 与 cache-prefix 的证据整理

### 3.1 现行 Athena 文档已经把“存储 append / prompt rebuild”拆开

- `perception-protocol-and-session-design.md` 明确写出：**“分组不符合 append-only”只对 prompt 成立，对存储不成立**；transcript 仍 append-only，而 prompt 是每帧重算的 projection（约 `:260–261`）。
- 该设计把 frame 定为冻结的 user message，视野摘要块置尾、每帧丢弃重建且“不冻结”（约 `:263–307`）；易变内容（HP、时间、背包、在线人数）放尾部，system prompt 保持稳定前缀（约 `:338–341`）。
- 设计还规定 cache breakpoint 放在最后一条冻结 `frame` message 上，视野块永不进入缓存 prefix；compaction 是批量事件而不是每帧小修（约 `:338–341`、M-32 `:555–556`）。这是**documented design / 未实现**，不是当前 runtime 行为。
- 当前实现仍远未达到该设计：`plugins/cortex-chat/src/index.ts:15–44` 只有 echo；`docs/06-progress-and-roadmap.md:23–30,59–68,231–290` 明确 Cortex 没有真实 LLM loop、Memory 仍是 in-memory stub，session/context 设计未落地。

### 3.2 外部证据如何支持、又如何限制该拆分

1. Anthropic 的“每次 inference 重新 curation”支持 prompt projection 需要每请求更新。
2. Anthropic 的 JIT/hybrid 说明稳定资料可以预加载、动态资料运行时获取；因此“每请求 rebuild”不等于每次从零重写所有 token。
3. Chroma 的 controlled findings 说明把所有事件单调 append 到可见窗口会增加干扰和退化风险；但它没有证明某种具体 run-length block、JSONL 或 cache breakpoint 必然最优。
4. 官方 Claude cache 规则说明 prefix 只在 provider 允许的相同 cacheable 区域复用；动态尾部重建可以与 prefix reuse 并存。

### 3.3 §A 不应作的二元化结论

- **不是“append-only 或 rebuild-only”**：持久化 transcript 可以 append-only；模型输入是其有 provenance 的 projection，按 frame/context budget 重建。
- **不是“历史越完整越好”**：Chroma 显示即使任务固定，额外输入也会退化；相关 distractor、语义相似度和结构会改变损害程度。
- **不是“cache hit 就等于 prompt 正确”**：cache 只说明一段 prefix 可复用；TTL、prefix mutation 与 state freshness 是不同问题。
- **不是“tool result 必须全留或全删”**：原始大结果可 offload/clear，关键 error、receipt、derived state 仍可能必须保留；Athena 当前设计对 interruption 明确要求 transcript 保留已执行 tool result。

## 4. §B：World-state snapshots、memory/history、long-horizon continuity

### 4.1 State freshness

- Anthropic 的 JIT 机制把 file path、stored query、web link 等轻量 ref 留在 context，数据在需要时才加载；其明确动机之一是绕开 stale indexing。
- 现行 Athena 文档把 mutable perception/view 放在尾部并每帧重建，避免模型引用冻结的旧 HP、时间或在线人数（`perception-protocol-and-session-design.md` §5.3、约 `:307–341`）。
- 因而 snapshot 的“新鲜”来自重新读取 authoritative state，而不是来自它是否落在 cache 或 transcript；cache TTL 不能代替 snapshot validation。
- **Inference**：对于具有世界状态的 World Cortex，应该记录 snapshot 的采样时间、来源/版本或覆盖范围；外部文章没有给 Athena 的具体 schema，不能替项目做未授权的字段设计。

### 4.2 Memory vs. chat history

- OpenAI Memory FAQ 是最直接的一手证据：memory summary 是 synthesis，可能不展示全部 memory；saved memory 与 chat history 分开；删除历史和删除 memory 是两个操作；Temporary Chat 既不读取既有 memory，也不产生 memory。
- Anthropic 的 structured note-taking 也把 notes 存到 context 外，并在 reset 后按需召回；这更接近“可读写长期 state”，不是把所有历史永远塞进 prompt。
- **Correction**：memory/history 不是互斥二选一，也不是同义词。history 更像事实/事件/对话记录；memory 更像经筛选、可变、可编辑、可能带 freshness/冲突的派生 state。当前 Athena `Life` 目标含 persona/memory/self-model，但实际 Memory 仍是 in-memory stub（`docs/06-progress-and-roadmap.md:23–30,60–63`）。

### 4.3 Long-horizon agents

- Anthropic 给出三种不同机制：
  - **Compaction**：保留连续对话感，适合 back-and-forth；
  - **Structured note-taking**：适合有里程碑、需跨 reset 的任务；
  - **Sub-agent architectures**：适合并行 research/深度工具操作，由主 agent 收敛摘要。
- 这三者不是同一算法的三个名字；它们分别作用于“同一线程的上下文压缩”“外部持久化状态”“隔离的工作上下文”。
- Chroma 的结果解释为何需要这些机制，但没有证明压缩摘要一定比原文好；Anthropic 也明确警告过度 compaction 会丢掉后见之明才重要的细节。
- OpenAI Memory FAQ 证明产品级跨 chat memory 存在，但不证明该机制足以支撑长 horizon agent 的 tool-loop、world state 或 transactional resume。

## 5. 对 Athena 七个历史目标场景的关系（只做 evidence mapping，不给最终架构建议）

| 场景（历史 spec User Story）                                      | 外部证据能支持的点                                                                                                                                                           | 当前 Athena 关系 / 限制                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Adapter Developer Provides IM Capability**                   | Anthropic 说 tools 应 self-contained、robust、token-efficient、避免 overlap；这支持 capability/tool 输出应有清晰契约和低噪声结果。                                           | 不能由外部文章推出 Cordis registration 或 Satori routing。当前 `capability-message` 已实现出站/隔离，但统一 Perception translator 仍是 approved-not-implemented 设计。历史 spec `:15–39` 的 pull-based wording 已被后续 push-based 设计取代。 |
| **2. Mode Developer Consumes Capabilities Platform-Agnostically** | JIT retrieval、progressive disclosure、hybrid upfront + runtime search 支持 Mode 自己决定何时把 capability data 投影进 context；工具定义应最小且低重叠。                     | 当前 D-37 设计让 capability 产出 Perception，Cortex 决定缓冲/渲染；不应把 provider-specific cache 或 retrieval 行为写进 protocol。                                                                                                            |
| **3. End User Composes a Digital Life**                           | OpenAI/Anthropic 都区分持久 memory/notes 与当前对话；这说明身份/长期 state 不应只依赖当前 chat window。                                                                      | Cordis declarative composition 是 Athena-specific，七篇外部来源没有直接证据。当前 Life/persona/memory 的 runtime 仍部分 stub；热添加/多 Life 不能以文章自述替代测试。                                                                         |
| **4. Mode Controls Perception Mediation**                         | Chroma 证明 distractors 和长输入会非均匀伤害；Anthropic 证明 JIT/compaction 可把 raw events 与 model-visible context 分开。                                                  | 直接支持 World/Interlude 的 mailbox/debounce/gated drain，而非 raw event→LLM 直通。当前设计把 Chat immediate、World buffered、Interlude optional session 分开（`perception...md` §8）；实现尚未完成。                                         |
| **5. Capability Protocol Extensibility**                          | Anthropic 的 tool contract / progressive disclosure 说明扩展能力应能按需暴露，避免所有工具定义同时占用 context。                                                             | 对 Audio/Vision/Haptic protocol 的开放注册仍属 Athena 设计；外部文章不能证明 Cordis `declare module` 或 feature negotiation。应把“工具可发现性”与“上下文何时加载”分开。                                                                       |
| **6. Multiple Lives, Shared Platform**                            | OpenAI 的 memory 独立存储与来源控制说明持久 state 需要 namespace/删除边界；Anthropic 的 sub-agent isolation 说明上下文隔离可减少污染。                                       | 不能据此推出两个 Life 如何共享一个 Bot 或 route message。当前多 Life 依赖 `life` isolate/filter；共享 Nerve、scene dedupe、response attribution 仍是未决/未实现问题。                                                                         |
| **7. Life Persistence and Mode Switching**                        | Structured notes、OpenAI saved memory 与 chat history 分离，都支持“identity/long-term state”与“当前认知 transcript”分层；compaction 说明 mode/session 可以重建可见 context。 | 外部来源没有证明 Athena 的 mode switch transaction 或 Life.bind disposer。当前设计明确 Life memory 持续、Cortex 内部状态可丢；当前代码/Memory persistence 仍未实现，必须按文档与行为测试核验。                                                |

## 6. Implemented / documented / inferred / unverifiable 分界

### 已实现（current code）

- `plugins/cortex-chat/src/index.ts:15–44`：只有 `CortexChat` echo；没有 LLM、compaction、tool loop、cache 或真正 session。
- `plugins/capability-message/src/index.ts:45–72,80–109`：MessageService 的 Satori 安装、isolation/filter、出站发送与 bot resolution 已实现，但不等于统一跨 capability context construction。
- `plugins/life` 的 Memory 目前为 in-memory stub；roadmap 明确 persistent Memory 未完成（`docs/06-progress-and-roadmap.md:23–30,60–63,258–290`）。

### 已记录的 documented design（尚未实现）

- Perception envelope、per-scene buffering、frame snapshot、run-length blocks、append-only transcript + prompt projection、compaction、cache breakpoint 规则：`.specify/specs/perception-protocol-and-session-design.md` §3–§13，尤其约 `:260–341,393–415,493–496,541–556`。
- 其中明确：视野摘要每帧重建且不冻结；tool result 在打断后完整落 transcript；archive 不承载 Cortex 内部 tool message；session 是普通库而非 Service。

### Code-based inference（不是外部来源原话）

- authoritative world state 应在 request-time 读取/版本化，动态 snapshot 不应污染 stable cache prefix。
- transcript、archive、memory、model-visible projection 需要不同 retention/freshness 语义。
- prefix cache 命中率只能作为稳定性/复用指标，不能作为事实新鲜度或回答正确性的代理指标。

### Unverifiable / unknown

- X 文章全部正文论点。
- Manus 原文的具体 cache hit-rate、工具数、filesystem/offload 数值、recitation 实验收益。
- Claude 5 “移除 80% system prompt”及其 exact date/benchmark；当前只能看到二手索引片段。
- Claude support 页的 memory/chat-search 自动化、删除、召回和 freshness 细节。
- 七篇来源没有给出 Athena 特定的 `Life` namespace、snapshot schema、compaction threshold、cache hit threshold 或 tool-result retention policy。
- 不做 §D price validation；这里只保留 cache breakpoint/TTL 的机械语义。

## 7. Corrections to binary framings

1. **“全量 append vs. 每次 rebuild”** → append-only 可以是 durable storage invariant；model prompt 是按 request/frame rebuild 的 projection。
2. **“长 context 有效 vs. 无效”** → 是随长度、相关性、distractor、位置/结构与任务语义变化的 degradation curve；Chroma 不支持一个 universal cutoff。
3. **“memory 或 chat history”** → memory 是从历史/文件/交互派生的独立 state layer，可能不完整、会陈旧、可编辑/删除；两者可以同时存在。
4. **“tool result 全保留 vs. 全清除”** → 原始大 payload、derived facts、error/receipt、可重放引用应分层；Anthropic 的 tool-result clearing 是 compaction tactic，不是语义删除命令。
5. **“缓存命中 vs. 状态新鲜”** → cache 只复用符合 provider key/TTL/prefix 规则的 tokens；fresh snapshot 必须重新验证 authoritative source。
6. **“预先 RAG vs. 不检索”** → Anthropic 明确给出 hybrid：少量稳定资料 upfront + 运行时 JIT exploration；选择取决于数据动态性和任务成本。
7. **“单 agent vs. 多 agent”** → compaction、notes、sub-agents 是针对不同任务结构的三种手段；不是互斥意识形态，也没有一篇来源证明其中一项总胜。
8. **“缓存 prefix 越大越好”** → prefix 需要稳定、cacheable 且不过度塞入低价值/易变内容；context rot 与 TTL 同时限制收益。

## 8. 最小引用清单

- Anthropic: https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
- Chroma: https://www.trychroma.com/research/context-rot
- Manus (指定 URL，当前 404): https://manus.im/blog/Context-Engineering-for-AI-Agents-Lessons-from-Building-Manus
- Claude blog (指定 URL，抓取超时): https://claude.com/blog/the-new-rules-of-context-engineering-for-claude-5-generation-models
- OpenAI Memory FAQ: https://help.openai.com/en/articles/8590148-memory-faq
- Claude support (指定 URL，抓取超时): https://support.claude.com/en/articles/11817273-use-claude-s-chat-search-and-memory-to-build-on-previous-context
- X (指定 URL，bot-blocked): https://x.com/free_ai_guides/article/2082463119742320825
- Supplemental official cache docs: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

**结论边界**：上述材料足以支撑“分层、按 request 选择性重建、稳定 prefix + 易变 tail、长期 memory/notes 与 append-only record 分离、compaction/外部化/隔离并存”的证据输入；不足以在本报告中选择 Athena 的最终 session schema、compaction algorithm、cache threshold、routing policy 或完整 architecture。
