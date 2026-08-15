# Athena Harness 架构设计基线

> 状态：已确认的概念设计基线。
>
> 本文总结截至当前讨论已经确定的职责边界、核心理念和重要约束。本文不是接口规范、包结构方案或实施计划，不预设 TypeScript 接口、文件拆分和迁移步骤。

## 1. 项目定位

Athena Harness 是一个 monorepo，也是一套用于构建拟人化 Agent 产品的开发框架与组件生态。

仓库的目标不是用一个固定运行流程抽象 YesImBot、YesImBotWorld 和 HDS-Interlude，也不是从三者中提取一个最低公分母式的统一产品 Runtime。它应提供分层的工具包、默认实现和替换缝，使开发者能够在同一底层框架上组合出不同的 Agent 执行方式和产品运行模式。

Athena Harness 包含两个必须严格区分的层次：

1. **Harness Core**：通用 Agent Loop 执行环境；
2. **Athena Runtime**：面向拟人化 Agent 产品的运行时。

`@yesimbot/agent-runtime` 是另一套完全独立的产品。Harness Core 在概念上同样属于 agent runtime 层，但不依赖、不兼容、也不照搬 `@yesimbot/agent-runtime` 的概念和接口。

## 2. 核心理念

### 2.1 Cordis 是微内核，不是 Agent Runtime

Cordis 负责：

- Plugin 和 Fiber；
- Service 与依赖注入；
- Context 派生；
- Effect 所有权；
- 安装、卸载和资源清理；
- 事件、日志、定时器等基础设施。

Cordis 不理解 Agent、Session、Turn、Step、Tool Call、ModelMessage 或产品 Mode。Harness 不应重新实现一套与 Cordis 平行的插件生命周期、依赖注入或 Effect 系统。

### 2.2 Harness Core 让不同的 Agent Loop 可运行

Agent 的共同能力包括：

- 收集和维护执行上下文；
- 组合用户输入、系统提示词和环境信息；
- 获取当前可用工具；
- 从 Session Log 派生模型输入；
- 构造并发送模型请求；
- 解析模型输出；
- 处理原生 Tool Call 或其他结构化结果；
- 记录执行事实；
- 判断继续、等待、结束、失败或取消。

这些能力属于 Agent Loop 领域，而不是 YesImBot、World 或 Interlude 的产品领域。Harness Core 应围绕可替换 Agent Loop 提供它们所需的最小执行环境。

### 2.3 Athena Runtime 组织拟人化 Agent 的长期存在

Athena Runtime 位于 Harness Core 之上，负责：

- 产品中的 Agent 身份和生命周期；
- 外部刺激、观察和感知；
- 主动调度、等待和唤醒；
- 产品状态、记忆、世界和故事；
- 多 Agent 的所有权关系；
- Mode 选择与切换；
- 外部平台适配；
- 产品级输出、重试和恢复策略。

Athena Runtime 的目标是提出一套拟人化 Agent 新范式，但这种统一发生在组合框架和生命周期层面，不要求不同 Mode 使用相同的内部控制流。

### 2.4 Mode 通过替换和组合能力表达产品差异

Mode 属于 Athena Runtime，不属于 Harness Core。

Mode 可以选择或组合不同的：

- Agent Loop；
- Session 投影；
- Prompt 组成；
- Tool 集合；
- 调度和唤醒策略；
- 产品状态；
- 输出策略；
- 平台能力。

YesImBot、YesImBotWorld 和 HDS-Interlude 可以被吸收为不同 Mode 的设计来源，但不要求逐项兼容历史实现，也不要求所有历史概念进入框架核心。

## 3. 总体分层

以下是逻辑职责分层，不代表包名或目录结构：

```text
Cordis
  └─ 组合、依赖、生命周期、Effect、基础设施

Harness Core
  ├─ Agent 控制面
  ├─ 可替换 Agent Loop
  ├─ Session Log
  ├─ Turn / Step 执行边界
  ├─ Tool 环境
  ├─ Prompt 组合
  ├─ Session → ModelMessage 投影
  ├─ Persistence
  └─ 默认原生 Tool Call Loop

Athena Runtime
  ├─ 身份与长期生命周期
  ├─ 刺激、感知和事件路由
  ├─ 调度、等待和唤醒
  ├─ Mode 与 Mode 切换
  ├─ 产品状态和记忆
  ├─ 多 Agent 所有权
  └─ 平台无关的产品行为

Modes / Products / Adapters
  ├─ Chat / YesImBot Mode
  ├─ World Mode
  ├─ Interlude Mode
  ├─ Koishi / OneBot Adapter
  └─ 未来产品插件
```

依赖只能自上而下：

- Harness Core 可以依赖 Cordis；
- Athena Runtime 可以依赖 Harness Core；
- Mode 和 Adapter 可以依赖 Athena Runtime 与 Harness Core；
- Harness Core 不能依赖 Athena Runtime、Mode、Koishi 或具体产品。

## 4. Harness Core 的领域边界

### 4.1 Agent

Harness Core 中的 Agent 是执行控制对象，而不是产品人格或平台会话。

它用于关联：

- 当前采用的 Agent Loop；
- 一个或多个 Session；
- 当前执行状态；
- 取消和停止能力；
- 执行所需的 Cordis Context。

Core Agent 不应默认等同于：

- Koishi Channel；
- 数字生命身份；
- World 中的 Bot；
- HDS Story；
- Cordis Fiber。

产品身份、角色关系和世界归属由 Athena Runtime 或 Mode 定义。

### 4.2 Agent 与 Session 的关系

Agent 和 Session 的基数不固定为一对一。

一个 Agent 可以：

- 使用一个主 Session；
- 拥有或访问多个 Session；
- 由 Runtime 在每次激活时选择 Session；
- 在不同 Mode 中采用不同的 Session 组织方式。

这样可以覆盖频道级对话、全局 Bot 管理多个聊天上下文，以及 Narrator 服务多个 Story 等场景，而不把平台或产品结构硬编码到 Harness Core。

### 4.3 Agent Loop

Agent Loop 是 Harness Core 最重要的替换缝，代表一次 Agent 执行的完整控制策略。

Agent Loop 可以：

- 只调用模型一次；
- 执行多轮原生 Tool Call；
- 持续等待 mailbox；
- 根据结构化 NarrativeDecision 更新状态；
- 在一次执行后结束；
- 或维护一个长期任务。

Harness Core 不要求 Agent Loop 必须是 ReAct、必须包含固定数量的 Step，也不要求所有 Loop 使用相同内部流程。

Agent Loop 必须遵守 Core 的外部执行约束：

- 执行事实进入 Session Log；
- Tool Call 与 Tool Result 可关联；
- 支持取消和停止；
- 失败和中断具有可观察状态；
- 不绕过资源所有权和清理边界。

Agent Loop 作为整体在 Cordis 组合阶段被选择或替换。Core 不以“全部可替换”为目标，不默认把 Loop 内部每个阶段都暴露为插件接口。

### 4.4 Session Log

Session Log 是 Agent 执行事实的 append-only 记录，是模型输入投影和执行观察的基础。

适合进入 Session Log 的内容包括：

- 输入消息或环境输入；
- Turn 和 Step 生命周期；
- 模型请求边界；
- assistant 输出；
- Tool Call 和 Tool Result；
- 错误、取消和中断；
- 压缩、替换或 checkpoint 事件。

Session Log 不是产品全部状态。以下内容不要求进入 Core Session：

- 世界地图和时钟；
- Story、Participant 和剧情计划；
- Koishi Channel 配置；
- 权限和平台资源；
- Mode 私有状态；
- 产品调度队列。

应始终区分：

```text
Session Log = Agent 执行事实
Product State = Athena Runtime / Mode 的领域事实
```

### 4.5 Agent Event 与 Runtime Event

框架存在两个不同的事件平面。

#### Harness Core 执行事件

它们描述可持久化的 Agent 执行事实，例如：

- Turn 开始、完成、失败或取消；
- Step 开始和结束；
- 模型请求和响应；
- assistant 消息；
- Tool Call、Tool Result 和 Tool Error。

这些事件属于 Session Log 和 Agent Loop 领域。

#### Athena Runtime 产品事件

它们描述产品刺激和领域事实，例如：

- 用户或频道消息；
- 定时任务到期；
- 手机通知；
- 世界心跳；
- Story Intent 到期；
- Mode 变化。

Runtime 决定是否以及如何把产品事件转换为 Session 输入。两类事件不能因为都叫 `AgentEvent` 而被合并成一个无边界的事件体系。

### 4.6 Turn

Turn 表示一次有边界的 Agent 激活或执行目标，不要求等于一条用户消息。

它可以由以下事件触发：

- 用户消息；
- 系统事件；
- 定时任务；
- mailbox 中的一组观察；
- 一次 NarrativeRequest；
- Runtime 主动行为。

对于长期运行的 Agent Loop，Turn 可以作为 Loop 内部的逻辑执行边界，而不等于 Loop 本身的生命周期。

### 4.7 Step

Step 表示一次模型请求及其直接结果边界，通常覆盖：

- 派生模型输入；
- 组合 Prompt 和 Tool；
- 调用模型；
- 接收 assistant 输出或 Tool Call；
- 处理并记录 Tool Result。

并非所有 Turn 都必须有多个 Step。单次决策型 Loop 可以每个 Turn 只有一个 Step。

### 4.8 Tool

Harness Core 的 Tool 能力负责模型执行层的共同机制：

- 模型可见 schema；
- 调用参数；
- 执行入口；
- Tool Result；
- 错误和取消；
- 与 Session Log 的记录关系。

具体 Tool 的产品语义由 Athena Runtime 或 Mode 提供，例如发送消息、打开应用、观察世界、推进 Story 或读取记忆。

Harness Core 优先支持模型供应商和 AI SDK 的原生 Tool Call，不使用 Prompt JSON 模拟 Tool Call 作为默认执行方式。

并非所有 Agent Loop 都必须使用 Tool Call。NarrativeDecision 等结构化输出可以由相应 Loop 直接处理，而不必伪装成 Tool。

### 4.9 Prompt

Harness Core 支持构造模型请求所需的 Prompt 能力，但不拥有具体人格和产品内容。

需要容纳的内容包括：

- 稳定系统提示词；
- Agent 或 Mode 提供的 Prompt Fragment；
- 每个 Step 动态产生的环境信息；
- Session 投影产生的 ModelMessage。

Prompt 能力和 Session 投影必须职责清晰：前者贡献指令和动态上下文，后者把执行历史派生为模型可见消息。

### 4.10 Model Surface / Projection

Session Log 与模型输入不是同一种表示。Harness Core 需要把 Session Log 投影为模型供应商或 AI SDK 可接受的 `ModelMessage`。

投影能力应支持：

- 排除 Runtime 内部事件；
- 将环境事件转换为模型消息；
- 注入当前观察；
- 用压缩结果替换历史区间；
- 按 Agent Loop 或 Mode 使用不同投影策略。

投影应尽量是 Session Log 和当前配置的纯派生结果，不成为第二份隐藏状态。

`Model Surface` 作为能力成立，但其公开形状、操作分类和是否独立成为根级 Service 尚未确定。

### 4.11 Persistence

Harness Core 需要 Session Log Persistence 契约和最小可运行实现。

当前确认的最低保证是：

- append-only；
- 单 Session 内有序；
- Tool Call 与 Tool Result 可关联；
- Turn 和 Step 能恢复到明确的完成、失败、取消或中断状态；
- Projection 可以从日志重新派生；
- Persistence Provider 可替换。

第一阶段不承诺外部副作用 exactly-once，也不自动承诺“副作用前持久化意图、崩溃后绝不重放”。更强的 durable intent/effect barrier 需要单独确认和设计。

### 4.12 默认 Agent Loop

Harness Core 提供一个最小的原生 Tool Call Loop，作为：

- 开箱可运行的默认实现；
- Core 各能力的集成样例；
- Agent Loop 替换契约的测试基准。

其概念流程为：

```text
输入进入 Session
→ 从 Session 派生 ModelMessage
→ 组合 Prompt 和 Tool
→ 调用模型
→ 记录 assistant 输出或 Tool Call
→ 执行并记录 Tool Result
→ 判断继续、结束、失败或取消
```

默认 Loop 不是 Athena 唯一范式。World、Interlude 和未来 Mode 可以整体替换它。

## 5. Athena Runtime 的领域边界

### 5.1 身份与生命周期

Athena Runtime 定义拟人化 Agent 在产品中的身份、归属和长期生命周期。Agent 生命周期不与单条用户消息或单次模型调用绑定。

“长期存在”可以通过持久身份和状态实现，不要求所有 Mode 都维护进程内常驻推理循环。是否常驻、何时休眠、如何恢复由 Mode 决定。

### 5.2 刺激、感知和上下文入口

Runtime 接收用户消息以外的刺激，包括：

- 平台消息；
- 系统事件；
- 定时任务；
- 世界变化；
- 其他 Agent 行为；
- Runtime 主动产生的事件。

Runtime 负责把产品事件转换为某个 Agent、Session 和 Agent Loop 可以处理的输入。Harness Core 不直接理解 Koishi Session、手机通知或剧情 Intent。

### 5.3 调度、等待和唤醒

调度、等待和唤醒属于 Runtime/Mode，而不是 Harness Core。

不同 Mode 可以采用：

- 消息触发的有限执行；
- mailbox 和常驻 Loop；
- timer/tingle；
- debounce/sweep；
- due intent；
- 产品自定义调度器。

Core 只提供 Loop 执行、取消、停止和可观察状态，不规定调度策略。

### 5.4 产品状态

Runtime 或 Mode 拥有频道、世界、Story、记忆、关系和计划等产品状态。

这些状态可以引用 Session，也可以把领域事件投影到 Session，但不应被强迫采用 Core Session Log 的数据模型。

### 5.5 多 Agent 所有权

多 Agent 的父子、协作、观察者、导演或世界裁定关系属于 Runtime/Mode。

Harness Core 可以运行多个 Agent，但不预设：

- parent/child agent；
- subagent 树；
- 全局 Bot 与频道 Agent 的关系；
- WorldAgent 与 BotAgent 的所有权；
- Narrator 与 Story 的基数。

### 5.6 Platform Adapter

Koishi、OneBot 和其他外部平台位于 Adapter 边界。

Adapter 负责：

- 把平台对象转换成 Runtime 事件；
- 持有瞬态平台 Session 或 Client；
- 把 Runtime 输出投递回平台；
- 处理平台权限、assignee、频道选择和传输细节。

Harness Core 不依赖外部平台类型。

## 6. Mode 模型

Mode 是 Athena Runtime 的组合单元，用来表达不同拟人化运行机制。

三种历史产品可以形成以下设计参照：

| 维度 | Chat / YesImBot Mode | World Mode | Interlude Mode |
|---|---|---|---|
| Agent Loop | 消息触发的有限 Tool Loop | mailbox 驱动的长期 Loop | 单次 Narrative 决策 Loop |
| 输入 | 消息和系统事件 | 通知、世界事件、tingle | 消息、due intent、sweep |
| Session 投影 | 对话历史 | 当前观察、设备和世界信息 | Story、Facts、Intents |
| Tool/结果 | 回复、搜索、记忆 | open_app、act、wait、send | 台词、事实和状态变更 |
| 调度 | 消息或事件触发 | mailbox、timer、tingle | debounce、interval、due intent |
| 产品状态 | Channel Conversation | World State | Story Database |
| 输出 | 平台消息 | 世界行为或平台消息 | 剧本台词和 State Patch |

这张表描述的是可组合差异，不要求未来实现逐项复制历史项目。

## 7. Mode 选择与切换

当前确认：

1. 创建或恢复 Agent 时选择初始 Mode；
2. 动态 Mode 切换是显式 Runtime 操作；
3. Mode 切换不是修改一个全局枚举；
4. 切换过程必须停止或移交旧 Mode 拥有的执行和资源；
5. 不自动迁移旧 Mode 的全部内部状态；
6. 目标 Mode 明确声明或选择继承哪些 Session 和产品状态；
7. Mode 私有状态默认保持私有，不因切换隐式泄漏给另一个 Mode。

具体切换协议、状态迁移格式和失败回滚语义尚未确定。

## 8. 组件化与可替换性原则

### 8.1 提供默认实现，但不固化唯一实现

Harness 应提供能够组成最小可运行系统的默认组件，包括默认 Agent Loop、内存或简单 Persistence、基础投影和 Tool 环境。

默认实现用于降低使用门槛和验证契约，不代表所有产品必须采用。

### 8.2 只在真实替换边界建立扩展点

优先确认的替换边界包括：

- Agent Loop；
- Persistence；
- Session Projection；
- Tool 贡献；
- Prompt 贡献；
- Mode；
- Platform Adapter。

没有第二实现或产品差异证据的内部步骤，不提前暴露工厂、Provider 或 Hook。

### 8.3 复用 Cordis Plugin 与 Service

组件组合、依赖和生命周期使用 Cordis。Athena 不建立第二种 Plugin 基类或 Effect 系统。

一个能力是否成为独立 Service，取决于：

- 是否有独立所有权；
- 是否被多个组件依赖；
- 是否存在真实替换需求；
- 是否能隐藏足够复杂度形成深模块。

因此 agents、sessions、tools、systemPrompt、modelSurface、persist 是合理的能力集合，但本文不确认它们必须恰好对应六个公开根级 Service。

### 8.4 不追求无差别的 Everything is a Plugin

Athena 借鉴 DSH 的组合思想，但不机械复制其微包数量、平行 LLM 协议、宽大 ToolRuntime 或每阶段 Hook。

优先选择：

- 深模块；
- 少量稳定概念；
- 直接使用 AI SDK 和 Cordis 契约；
- 整体替换 Agent Loop；
- 产品插件拥有自己的内部实现。

## 9. 所有权与生命周期约束

### 9.1 所有权分层

- Cordis Fiber 拥有插件和 Effect；
- Harness Core 拥有 Agent 执行对象和 Session 执行事实；
- Agent Loop 临时拥有活动 Turn/Step；
- Athena Runtime 拥有产品身份、状态和事件路由；
- Mode 拥有自己的调度器、资源和私有状态；
- Tool Provider 拥有具体副作用语义；
- Platform Adapter 拥有瞬态平台对象和投递行为。

### 9.2 生命周期原则

概念生命周期为：

```text
组合 Cordis Root
→ 安装 Harness Core 能力与默认组件
→ 安装 Athena Runtime 和 Mode
→ 创建或恢复 Agent
→ 选择 Mode、Agent Loop、Session 与组件
→ Runtime 接收刺激并触发 Loop
→ Loop 记录执行事实并产生结果
→ Agent 进入 idle、wait 或下一次执行
→ 可显式切换 Mode
→ 停止 Agent 和 Mode
→ 释放产品资源与 Core 资源
→ 卸载 Cordis Fiber
```

不依赖 Cordis 顶层 Effect 的全局异步完成顺序来实现业务 teardown。需要顺序保证的 drain、stop 和资源移交必须由拥有者显式组织并验证。

### 9.3 失败、取消和中断

- 模型失败、Tool 失败和 Runtime 失败应可区分；
- 活动 Turn/Step 支持取消；
- 取消或崩溃后的执行在 Session 中具有明确中断状态；
- 产品决定是否重试、补偿或放弃；
- 第一阶段不假设外部副作用 exactly-once；
- stop/dispose 后不能继续接受新工作或泄漏长期任务。

## 10. 可测试性与可观测性

### 10.1 Core 测试关注点

- Session append 顺序；
- Projection 的确定性；
- Tool Call 与 Tool Result 关联；
- 默认 Agent Loop 的继续和停止条件；
- 取消、失败和中断状态；
- Persistence 恢复；
- Agent Loop 替换契约；
- Cordis teardown 后无资源泄漏。

### 10.2 Runtime 和 Mode 测试关注点

至少使用三类代表性场景验证组合能力：

1. 消息与系统事件竞争触发的 Chat Mode；
2. wait 后被消息或 tingle 唤醒的 World Mode；
3. 消息 debounce 与 due intent 同时发生的 Interlude Mode。

这些场景用于验证模式差异是否能够由组合和替换表达，不要求三者共享同一内部 Loop。

### 10.3 可观测性

Session Log 提供持久执行事实；Cordis 事件和 Logger 提供运行时观察。二者职责不同：

- Session Log 用于执行历史、投影和恢复；
- Cordis Event/Logger 用于诊断、生命周期和瞬态通知。

不应为了可观测性把所有 Cordis 事件持久化，也不应把所有产品事件塞入 Core Session。

## 11. 明确不进入 Harness Core 的能力

以下能力属于 Athena Runtime、Mode 或具体产品：

- Mode 和 Mode 切换；
- 数字生命身份和人格；
- Channel、World、Story；
- 主动行为策略；
- wait/wake/scheduler；
- Observer、Director、Narrator；
- Body、手机和 QQ 等虚拟设备；
- 多 Agent 父子或协作关系；
- Koishi/OneBot 类型；
- 产品领域状态；
- 平台投递和回复节奏。

## 12. 非目标

Athena Harness 当前不以以下事项为目标：

- 用一个固定流程统一三个历史产品；
- 提取三个产品的最低公分母式 Product Runtime；
- 兼容历史版本；
- 兼容或包装 `@yesimbot/agent-runtime`；
- 让所有类、函数和执行阶段都可替换；
- 建立与 Cordis 平行的 Plugin、Service、Context 或 Effect；
- 建立与 AI SDK 平行的消息、模型和 Tool 类型体系；
- 第一阶段保证外部副作用 exactly-once；
- 在本文中确定 TypeScript 接口、包边界、文件拆分或迁移步骤。

## 13. 已确认决策摘要

1. Athena Harness 是 monorepo、开发框架和组件生态；
2. Harness Core 与 Athena Runtime 是不同层次；
3. Harness Core 是通用 Agent Loop 执行环境；
4. Athena Runtime 是拟人化 Agent 产品运行时；
5. Agent Loop 是 Core 的主要整体替换缝；
6. Core 提供默认原生 Tool Call Loop；
7. Session Log 是 append-only 的 Agent 执行事实记录；
8. Session Log 可持久化并可投影为 ModelMessage；
9. Agent 与 Session 不固定为一对一；
10. Runtime Event 与 Core Session Event 必须区分；
11. Mode 属于 Athena Runtime，通过组合和替换 Core 能力表达产品差异；
12. 初始 Mode 在创建或恢复时选择；动态切换是显式操作；
13. Mode 切换不自动迁移全部状态；
14. 产品状态不强制进入 Core Session；
15. 调度、等待和唤醒属于 Runtime/Mode；
16. Cordis 负责组合和生命周期，Athena 不实现第二套机制；
17. 第一阶段不承诺外部副作用 exactly-once；
18. 不为没有真实替换需求的组件提前建立接口；
19. 不在当前阶段确定具体 API 和文件结构。

## 14. 尚待后续设计的问题

以下问题有意留到接口设计前或原型验证阶段：

- Agent、Session 和 Agent Loop 的具体契约；
- Session Event 的具体 schema 和命名；
- 六项 Core 能力是否对应六个公开 Service；
- Model、Prompt 和 Projection 的最终边界；
- Persistence 的默认实现和事务强度；
- 是否以及如何实现 durable intent/effect barrier；
- per-agent scoped tools/prompt/projector 的具体机制；
- Mode 切换协议和状态迁移格式；
- 多 Agent 所有权和协作模型；
- Cordis 上游与 DSH fork delta 的取舍；
- monorepo 的包边界和文件布局。

这些问题在获得行为场景、替换需求和原型证据前不应被提前固化。
