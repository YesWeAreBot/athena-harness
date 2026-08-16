# Athena Runtime Mode 开发者文档

## 这套文档写给谁

这套文档写给想给 Athena 开发 Mode 的开发者。

你可以把 Athena 理解成一个“数字生命运行环境”。它不是只做一个聊天机器人，也不只是一个游戏框架，而是一套允许不同产品以不同方式运行的底层容器。

Mode 就是“运行方式”。比如：

- Chat Mode：收到消息，回消息。
- World Mode：Bot 生活在一个持续运行的世界里，被世界时间、心跳、环境事件驱动。
- Interlude Mode：Bot 在叙事剧本里生活，时间、关系、承诺、未完成的意图都会影响后续行为。

这三类产品差异非常大。文档的目标不是教你把它们做成一样，而是教你怎么在同一个 Life 下，用各自不同的 Mode 表达它们。

## 你正在构建什么

你写 Mode 时，不是写一个“插件函数”，而是写一套“这个数字生命在这个状态下如何感知、如何决策、如何记忆、如何行动”的规则。

因此你需要理解四件事：

1. Life 是什么。
2. Mode 是什么。
3. Mode 从环境里收到什么。
4. Mode 可以向世界输出什么。

## 核心概念

### Life

Life 是数字生命的长期身份。

它像“一个人的存在本身”。不管今天处于 Chat 状态、World 状态还是 Interlude 状态，这个人还是同一个人，还在同一个 Session 里，还拥有同一份记忆入口。

Life 负责：

- 创建和恢复 Session。
- 创建和释放 Agent。
- 挂载和切换 Mode。
- 挂载和卸载 Body。
- 路由 Percept。
- 触发恢复、持久化、释放。

### Mode

Mode 是 Life 当前采用的“生活方式”。

同一个 Life 可以切换 Mode。切换时旧 Mode 会停止，新 Mode 会启动。Life 不关心 Mode 内部怎么写 Prompt、怎么调度、怎么记忆，只关心 Mode 是否正确地声明了自己需要什么能力。

Mode 可以定义：

- 处理什么 Percept。
- 能使用什么 Actuator。
- 需要什么调度方式。
- 使用什么记忆策略。
- 使用什么模型。
- 使用什么状态。
- 使用什么投递方式。
- 使用什么媒体能力。

### Body、Percept、Actuator

Body 是 Life 与外部环境之间的接口。

想象一个人有手、眼睛、手机、电脑。Body 就是这些接口的抽象。

- Percept：外部环境发给 Life 的刺激，比如收到消息、看到世界变化、收到定时心跳。
- Actuator：Life 对外部环境执行的动作，比如发消息、移动、打开应用。

Mode 不直接连接平台，而是通过 Body/Percept/Actuator 与外部世界交互。

### Memory

Life 需要长期记忆，但不同 Mode 的记忆方式不同。

- Chat 可能只需要对话历史和事实。
- World 需要世界状态、新闻、Bot 的个人小事。
- Interlude 需要故事、参与者关系、承诺、剧情事实。

所以 LifeMemory 只做统一入口，真正的记忆策略由 Mode 的 MemoryProvider 实现。

### Scheduler

数字生命不一定只在收到消息时才行动。

World Mode 可能每过一段时间就“心跳”一次；Interlude Mode 可能到了某个时间才处理未完成的意图。Scheduler 负责这种主动行为。

### Delivery 与 Media

Mode 的产出不一定是文字。

- 可能发送到不同 conversation。
- 可能延迟发送。
- 可能发送图片、语音、视频。
- 可能需要媒体库、收藏夹、描述缓存。

Delivery 和 Media 就是这些能力的边界。

## 设计原则

### 核心薄，Mode 厚

athena-runtime 不替你实现 Chat、World 或 Interlude。

它只提供 Life 和一组能力边界。真正的产品逻辑应该写在 Mode 里。

### Life 拥有资源

Session、Agent、Mode、Body 的创建和释放由 Life 统一管理。

这样即使 Mode 写得很复杂，插件卸载、Life 销毁、并发操作时也不会留下泄漏。

### Mode 拥有策略

Life 不决定：

- 什么记忆值得保留。
- 什么状态需要压缩。
- 什么消息应该延迟发送。
- 用什么模型处理当前任务。

这些策略全部属于 Mode。

## 文档结构

- [01 快速开始](./01-quickstart.md)
- [02 Mode 生命周期](./02-mode-lifecycle.md)
- [03 Percept 与 Actuator](./03-percept-actuator.md)
- [04 Memory](./04-memory.md)
- [05 Model Provider](./05-model-provider.md)
- [06 State 与 Delivery](./06-state-delivery.md)
- [07 Media 与 Scheduler](./07-media-scheduler.md)
- [08 可观测性](./08-observability.md)

建议第一次阅读时按顺序看。遇到代码先跳过，先把每一节的“概念解释”读明白，再回来看代码。
