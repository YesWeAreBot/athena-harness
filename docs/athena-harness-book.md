# Athena Harness：从入门到精通

## 目录

1. 第一卷：先理解它是什么
2. 第二卷：从零到第一次运行
3. 第三卷：核心架构
4. 第四卷：一个消息如何流动
5. 第五卷：隔离、作用域与多生命
6. 第六卷：沙盒系统
7. 第七卷：能力、皮层与神经
8. 第八卷：配置与实例
9. 第九卷：运维与排障
10. 第十卷：从熟练到精通
11. 术语表
12. 附录：当前仓库地图

---

# 第一卷：先理解它是什么

## 第 1 章 一句话定义

Athena Harness 是一个面向“数字生命”的运行时内核与工具集。它的目标不是做一个“收到消息就回复”的聊天机器人框架，而是让一个数字实体持续存在、持续思考、在多个世界里同时行动。

这个定位决定了它和常见机器人框架的根本区别：

- 它不把“消息进来，消息出去”当作核心流程。
- 它不把“没有事件”当成“没有事情发生”。
- 它不把平台当作唯一存在空间。
- 它把身份、生存策略、世界接口看成三个独立但相互连接的原始概念。

## 第 2 章 它不是什么

理解一个项目，先理解它刻意不做什么。

Athena Harness 不是：

- 又一个通用 Agent 执行框架。
- 又一个聊天机器人框架。
- 一个固定的 LLM 消息处理流水线。
- 一个只存在于聊天平台里的“自动回复程序”。

它和 Koishi 共享 Cordis 与 Satori 技术底座，但组织原则不同。Koishi 的中心是“事件到响应”，Athena Harness 的中心是“一个存在如何活着”。它和 AstrBot 都使用 LLM，但 AstrBot 把每条消息放进固定流水线，Athena Harness 则把认知节奏交给生存策略本身。

## 第 3 章 三个原始概念

Athena Harness 的整个模型可以用三个问题概括：

1. 我是谁？
2. 我怎么活？
3. 我在哪里存在？

对应的三个概念是：

| 概念 | 英文 | 中文含义 | 回答的问题 |
|---|---|---|---|
| Life | 生命 | 持续的身份 | 我是谁 |
| Cortex | 皮层 | 完整的生存策略 | 我怎么活 |
| Nerve | 神经 | 与世界接触的通道 | 我在哪里存在 |

### Life

Life 是数字生命的身份层。它保存人设、长期记忆、自我状态，并且跨越进程重启、跨越 Cortex 更换、跨越 Nerve 增删而存在。

Life 不直接处理世界。它不负责接收消息，也不负责发送消息。它更像“这个存在本身”。

### Cortex

Cortex 是数字生命的生存策略层。它决定什么时候思考、如何整合感知、如何认知、如何行动、如何安排下一次思考。

Cortex 是一个整体，而不是几个可独立替换的轴。不同 Cortex 可能有完全不同的内部状态：聊天型 Cortex 使用会话上下文，世界型 Cortex 使用世界状态，叙事型 Cortex 使用故事库。

因此，Cortex 不能在运行中热切换。更换 Cortex 相当于“换一种活法”，需要显式停止再启动。Life 的记忆可以保留，Cortex 的内部工作状态会重置。

### Nerve

Nerve 是数字生命与世界之间的双向通道。它负责感知世界状态，也负责把行动送向世界。

在 IM 场景中，一个 Satori Bot 就是一个 Nerve。在沙盒场景中，Sandbox Nerve 是沙盒世界与某个 Life 之间的桥梁。未来也可以有 Minecraft、Live2D、音频等 Nerve。

多个 Nerve 可以同时存在。一个数字生命可以同时“存在于”QQ、沙盒页面、3D 世界等不同维度。

## 第 4 章 历史命名

早期 spec 使用过一套更哲学化的名称，后来被正式名称取代：

| 旧名称 | 新名称 |
|---|---|
| Spirit | Life |
| Pulse | Cortex |
| Medium | Nerve |
| Life Config | Instance |
| Pulse Preset | Cortex Preset |

阅读旧文档时，只要把旧名称替换成新名称，大部分概念仍然成立。

## 第 5 章 项目的阶段与状态

这是一个仍在快速演进的工程。阅读时需要区分三类内容：

1. **已实现**：当前仓库里真实存在的包和行为。
2. **已批准设计**：spec 中已经决定、但尚未完全落地的机制。
3. **历史存档**：`legacy/` 中已经废弃的旧实现。

当前已实现的骨架包括：

- `@athena-ai/protocol`：核心类型、Cortex 抽象类、沙盒协议类型。
- `@athena-ai/plugin-life`：Life 运行时服务。
- `@athena-ai/capability-message`：IM 能力服务，包装 Satori。
- `@athena-ai/cortex-chat`：第一个聊天型 Cortex。
- `@athena-ai/adapter-onebot`：OneBot 适配器。
- `@athena-ai/plugin-sandbox`：全局沙盒 Hub。
- `@athena-ai/sandbox-nerve`：每个 Life 的沙盒 Nerve。

当前版本的 `@athena-ai/core` 是一个很薄的 prelude 壳，更多框架职责由 `@athena-ai/protocol` 和 `@athena-ai/plugin-life` 承担。

---

# 第二卷：从零到第一次运行

## 第 6 章 你应该先看什么

如果你第一次接触这个仓库，不建议直接读所有源码。建议按这个顺序建立地图：

1. 先读本文。
2. 再读 `.specify/specs/design-philosophy-and-positioning.md`，理解定位。
3. 读 `.specify/specs/spirit-pulse-medium-domain-model.md`，理解概念模型。
4. 读 `.specify/specs/naming-and-package-architecture.md`，理解命名和包结构。
5. 读 `.specify/specs/multi-life-isolation-design.md`，理解当前实现中最关键的问题。
6. 最后读包源码和测试，验证你已经建立的心理模型。

## 第 7 章 仓库里的主要区域

仓库布局可以分成六个层次：

| 区域 | 作用 |
|---|---|
| `.specify/specs/` | 设计文档，回答“为什么这么做” |
| `packages/` | 框架核心包 |
| `plugins/` | 可安装的能力、Cortex、适配器和沙盒插件 |
| `vendor/` | 从上游锁定的 Satori 相关代码 |
| `legacy/` | 旧架构存档，不要作为当前实现参考 |
| `test/`、各包内测试 | 说明系统行为的可执行证据 |

## 第 8 章 “运行”的抽象

Athena Harness 的运行不是一个大程序，而是一棵由插件组成的上下文树。

最外层是根上下文。根上下文里加载共享基础设施，例如 WebUI、日志、HTTP 服务。每个 Life 通常被放进一个分组，分组有自己的隔离服务。Life 分组内部再安装 Life 服务、消息能力、Cortex、适配器和沙盒 Nerve。

这种组装方式来自 Cordis：插件负责注册服务、订阅事件、管理生命周期。用户不需要手动连接各个部件。

## 第 9 章 第一次运行前要建立的心智模型

不要把 Athena Harness 想象成“一个 app”。它更像一个舞台：

- 根上下文是剧场。
- Life 分组是演员。
- Cortex 是演员的剧本。
- Nerve 是演员与观众之间的媒介。
- 沙盒页面是让观众直接和演员对话的窗口。

当你启动系统时，你其实是在启动一个 Cordis 进程，让这些插件按照声明自动组合。

---

# 第三卷：核心架构

## 第 10 章 技术底座

Athena Harness 刻意选择成熟基础设施，而不是重新发明：

- **Cordis v4**：负责上下文、依赖注入、事件、插件生命周期和隔离。
- **Satori v5**：负责 IM 协议、Bot、Session、消息内容模型和适配器生态。
- **AI SDK v7**：设计上作为 LLM 调用层，当前 Chat Cortex 仍以回显为主，LLM 能力还在演进。

这看起来和 Koishi 很像，但区别不在技术，而在组织原则。Athena Harness 使用 Cordis 的方式不是“消息中间件”，而是“数字生命运行时”。

## 第 11 章 核心包

### `@athena-ai/protocol`

这是当前框架的协议层，负责定义：

- Cortex 抽象类。
- LifeService 接口。
- Persona、MemoryProvider 等类型。
- 沙盒 Hub 与 Nerve 之间的接口。
- Cordis 上下文上的 `life`、`sandbox` 类型声明。

Cortex 继承自这里的抽象类。Life 服务实现这里的接口。

### `@athena-ai/core`

当前是 prelude 壳，作用是为未来全局预处理预留位置。它不代表整个框架；真正的协议职责已经移到 `@athena-ai/protocol`。

### `@athena-ai/plugin-life`

这是 Life 的运行时实现。它提供 `life` 服务，包含：

- Persona 解析。
- 一个临时的内存记忆实现。
- 一个“每 Life 最多一个 Cortex”的绑定检查。

Life 与 Cortex 的绑定使用 Cordis 生命周期：Cortex 初始化时绑定 Life，Cortex 销毁时自动解绑。

## 第 12 章 能力层

### `@athena-ai/capability-message`

这是 IM 能力契约的实现。它提供 `message` 服务，并负责：

- 在 Life 分组内安装 Satori。
- 暴露 Bot 列表。
- 提供发消息、发私信等能力入口。
- 给 Session 注入事件过滤，保证事件只送到属于同一个 Life 的监听者。

它的关键设计是：Cortex 只依赖 `message`，不直接依赖 `satori`。平台实现被封装在能力服务后面。

## 第 13 章 Cortex 层

### `@athena-ai/cortex-chat`

这是第一个 Cortex 实现。当前行为非常接近“人设前缀回显”：收到消息后，跳过自己发送的消息，读取 Life 的人设，然后回复一条带人设名的消息。

它的意义不是复杂度，而是完整走通一条链路：Nerve 收到事件，事件进入 Cortex，Cortex 使用 Life 身份，再通过 MessageService 行动。

## 第 14 章 适配器层

### `@athena-ai/adapter-onebot`

这是 OneBot 协议的 Satori 适配器。它负责与 OneBot 实现通信，将平台事件转换成 Satori Session，并注册 Bot。

适配器安装在 Life 分组内，和 MessageService 共享同一个 Satori 隔离域。这样它能向 `ctx.satori.bots` 注册 Bot，而 Cortex 仍然只通过 `message` 访问 Bot。

## 第 15 章 依赖关系

框架里最重要的依赖规则是：

- Cortex 依赖 Life 和 MessageService。
- MessageService 依赖 Satori。
- Adapter 依赖 MessageService 和 Life。
- Sandbox Hub 依赖 WebUI。
- Sandbox Nerve 依赖 Sandbox Hub、Satori 和 Life。

依赖方向是单向的。Cortex 不依赖具体平台，平台通过能力服务接入。这让“换平台”不改变生存策略，也让“换生存策略”不改变平台连接。

---

# 第四卷：一个消息如何流动

## 第 16 章 从平台到 Cortex

一次典型的消息流动如下：

1. 平台把消息交给 OneBot 适配器。
2. 适配器把平台消息转换成 Satori Session。
3. Bot 把 Session 分发到 Cordis 事件系统。
4. MessageService 判断这个 Session 是否属于自己的 Satori 域。
5. 如果属于，就给 Session 打上 Life 作用域过滤标记。
6. Cortex 监听的 `message` 事件收到 Session。
7. Cortex 从 Life 读取人设。
8. Cortex 通过 MessageService 调用对应 Bot 发消息。
9. 消息回到平台。

## 第 17 章 谁拥有 Bot

在旧设计中，`ctx.bots` 是全局快捷方式。当前实现为了支持多个 Life 共存，移除了这个快捷方式。

现在 Bot 的归属路径是：

- MessageService 在 Life 分组内安装 Satori。
- Adapter 作为同一分组的兄弟插件，把 Bot 注册进 `satori.bots`。
- MessageService 的 `bots` 属性代理这个注册表。
- Cortex 通过 `message.bots` 或发送方法指定 Bot。

## 第 18 章 为什么事件需要过滤

当系统只有一个 Life 时，所有监听者收到所有事件通常没有问题。

当系统有多个 Life 时，Alice 的 Bot 收到消息，不能让 Bob 的 Cortex 也认为这是自己的消息。因此 MessageService 会给 Session 注入一个作用域过滤器。

过滤规则的本质是：事件只送给“与消息来源 Life 使用同一个 message 隔离符号”的监听者。

## 第 19 章 无消息时会发生什么

当前 Chat Cortex 是事件驱动的，没有消息就没有认知。

但项目定位明确要求框架不能把“无消息”当成“无存在”。未来的世界型 Cortex 应有心跳、定时器、内部状态检查，让 Life 在没有外部事件时仍然活着。

这正是 Athena Harness 与普通聊天机器人框架的分水岭：无事件不等于无计算，沉默也可以是策略的一部分。

---

# 第五卷：隔离、作用域与多生命

## 第 20 章 为什么要隔离

多个 Life 共享同一个进程时，至少有三个问题会出现：

1. 服务被注册两次。
2. 事件串台。
3. 同一个 Life 被多个 Cortex 绑定。

隔离不是可选项，而是多生命运行的基本约束。

## 第 21 章 Cordis 的隔离语言

理解隔离，需要先理解几个概念：

- **Context**：插件运行所在的上下文对象。
- **Service**：注册在上下文上的具名服务。
- **Isolate**：为某个服务名创建一个私有符号，使该服务在不同作用域中互不可见。
- **Fiber**：一次插件安装所产生的生命周期单元。
- **Inject**：声明一个插件需要哪些服务。

隔离不是创建完全独立的新进程，而是为服务名创建私有“钥匙”。同一个名字在不同隔离域中指向不同实例。

## 第 22 章 当前多 Life 配置的关键点

当前设计为每个 Life 分组声明以下隔离：

- `life`
- `cortex`
- `message`
- `satori`

这样每个 Life 拥有独立的 Life 服务、独立的 Cortex 服务、独立的 MessageService 和独立的 Satori 域。

`satori` 也必须隔离，因为它是一个会被多次注册的服务。没有隔离时，第二个 Satori 实例会与第一个冲突。

## 第 23 章 两个容易误解的细节

### 隔离只影响服务实例，不影响属性描述符

Cordis 的 `isolate` 影响服务存储，但不会让 `mixin` 或 `accessor` 注册的全局属性描述符变得可重复。

如果一个服务在构造时调用 `mixin`，那么同一个进程里通常只能有一个活动实例。这是当前仓库选择修改 vendored Satori、移除 `mixin` 调用的原因。

### Cordis 代理会让对象身份比较失效

Cordis 会包装服务实例，使同一个底层对象在不同上下文访问时看起来不是同一个对象。

因此，Life 与 Cortex 的绑定不能用简单身份比较判断是否还是同一个 Cortex，而是使用稳定名称进行比较。

## 第 24 章 多 Life 的取舍

多 Life 不是“把配置文件复制两份”那么简单。

它要求每个 Life 拥有独立身份、独立 Cortex、独立消息能力、独立 Satori 域，同时还能共享全局 WebUI、日志和沙盒 Hub。

这种架构为隔离付出了复杂度，换来的是两个 Life 可以在同一个进程里真正独立存在。

---

# 第六卷：沙盒系统

## 第 25 章 沙盒是什么

沙盒是一个浏览器中的虚拟聊天世界。它让用户不连接真实 IM 平台，也能与一个或多个 Life 对话。

沙盒不是测试工具那么简单，它是框架里第一个“非真实平台 Nerve”的完整实现。

## 第 26 章 Hub 与 Nerve 的分工

沙盒被拆成两部分：

### Sandbox Hub

Hub 是全局服务，负责：

- 注册唯一的 WebUI 页面。
- 注册浏览器 WebSocket 监听器。
- 维护 Life 注册表。
- 把浏览器消息路由到正确的 Life。

Hub 不拥有 Satori 状态。

### Sandbox Nerve

Nerve 是每个 Life 内部的桥，负责：

- 在 Hub 上注册自己的 Life。
- 在自己的 Satori 域中创建 Sandbox Bot。
- 接收 Hub 转发来的用户输入。
- 把消息派发成 Satori Session。
- 把 Life 的回复送回浏览器。

## 第 27 章 一个沙盒消息的流动

1. 浏览器向 WebSocket 发送一条消息。
2. Hub 根据 `lifeId` 找到对应 Nerve。
3. Nerve 在自己的 Life 域中创建或复用 Sandbox Bot。
4. Bot 把浏览器输入作为 Satori Session 分发。
5. Cortex 像处理真实消息一样处理它。
6. 回复通过 Sandbox Messenger 送回 Hub。
7. Hub 自动补上 `lifeId`，再送回浏览器。

## 第 28 章 为什么沙盒要这么做

如果直接把沙盒插件安装到每个 Life 分组，WebUI 页面和 WebSocket 监听器会重复注册。

Hub 与 Nerve 的拆分让“页面只有一个，Life 可以有多个”。页面是公共设施，Life 是私有世界。

---

# 第七卷：能力、皮层与神经

## 第 29 章 三者的关系

概念上：

- Life 问“我是谁”。
- Cortex 问“我怎么活”。
- Nerve 问“我在哪里存在”。

实现上：

- Life 是一个服务。
- Cortex 是一个服务，同时依赖 Life 和能力服务。
- Nerve 是注册到能力服务的插件。

## 第 30 章 能力是什么

能力是一个抽象契约，例如“消息能力”。

Cortex 不关心这个能力背后是 OneBot、Discord、Satori Bridge 还是沙盒。它只依赖 `message` 服务。

能力包负责：

- 定义服务接口。
- 管理多个 Nerve 实例。
- 定义事件类型。
- 把具体实现封装在隔离域后面。

## 第 31 章 Cortex 如何选择 Nerve

在一个 Life 内，可能存在多个 Bot。

单 Bot 场景下，Cortex 可以不指定目标，直接发送消息。

多 Bot 场景下，Cortex 需要指定 Bot 的稳定标识。每条 Satori Session 都带有来源 Bot，因此 Cortex 通常可以自然地回复“来自哪个 Bot”的事件。

## 第 32 章 三层工具模型

虽然本文不写代码，但工具模型是理解系统扩展性的关键。

### 第一层：结构化能力

这一层由 Nerve 提供，由 Cortex 的确定性逻辑调用。

例如“发送消息”“读取未读”“查询状态”。它是程序化接口，不是给 LLM 直接使用的自然语言工具。

### 第二层：产品语义工具

这一层由 Cortex 定义，给 LLM 使用。

例如“发消息”“看手机”“等待一段时间”。它把平台操作翻译成数字生命能理解的行为。

### 第三层：平台透传工具

这一层由 Nerve 提供，给 LLM 直接使用。

例如 OneBot 的置顶、戳一戳、群管理操作。它的价值是保留平台完整能力，而不是把平台能力压缩成最小公约数。

## 第 33 章 三层模型的工程意义

三层模型解决了两个问题：

1. Cortex 保持平台无关。
2. LLM 仍能访问平台的全部能力。

如果只有第一层，平台丰富能力会丢失。如果只保留第三层，Cortex 会绑定平台。分层让两者同时成立。

## 第 34 章 扩展点在哪里

如果未来需要新平台，主要工作是写 Nerve。

如果未来需要新生存方式，主要工作是写 Cortex。

如果未来需要新身份能力，主要工作是扩展 Life 服务或记忆系统。

这三个方向彼此独立，这也是本项目的核心可组合性。

---

# 第八卷：配置与实例

## 第 35 章 实例是什么

Instance 是“一个数字生命的完整组装声明”。它描述这个 Life 使用哪些服务、安装哪些 Cortex、连接哪些 Nerve。

设计目标是：一个实例文件就是一份可迁移、可复制、可版本管理的 Life 定义。

## 第 36 章 当前配置状态

需要区分设计与现状：

- spec 中规划了 `app.yml`、`cordis.yml`、`instances/alice.yml` 等文件。
- 当前仓库还没有一套最终形态的运行配置作为标准示例。
- `demo/athena.config.yaml` 是旧原型遗留，它使用的 `modes`、`bodies`、`lives` 结构已被 Life、Cortex、Nerve 取代。

因此，学习配置时应该以 spec 中的目标结构和当前包名为准，而不是把旧 demo 当作权威文档。

## 第 37 章 Persona 应该包含什么

Persona 是 Life 的身份核心，至少应表达：

- 名字。
- 一段描述。
- 一组性格特质。

未来还可以扩展记忆后端、自我模型、关系数据等。

## 第 38 章 配置的哲学

Athena Harness 强调“声明式组装”：

- 用户通过声明选择 Life 的身份。
- 用户通过声明选择 Cortex。
- 用户通过声明选择 Nerve。
- 系统自动完成连接。

配置的职责是表达意图，而不是编写接线过程。

---

# 第九卷：运维与排障

## 第 39 章 生命周期

理解生命周期，是排障的第一步。

一个 Life 分组启动时，插件按依赖关系激活：

1. Life 服务先可用。
2. MessageService 可用。
3. Adapter 注册 Bot。
4. Cortex 绑定 Life。

销毁时顺序相反。Cortex 先解绑 Life，然后 Bot、能力服务、Life 服务依次销毁。

## 第 40 章 常见错误模式

### Bot not found

当 Cortex 或 Nerve 指定了一个不存在的 Bot 时，会出现这个错误。

常见原因：

- Adapter 还没有注册 Bot。
- Bot 被销毁后仍有旧引用。
- 使用了错误的 `platform:selfId`。

### Only one Cortex per Life

当同一个 Life 内尝试安装两个 Cortex 时出现。

这通常是配置重复，或隔离配置不正确导致两个分组共享同一个 Life。

### property bots is already declared as accessor

这是 Cordis `mixin` 属性冲突。

当前实现通过修改 vendored Satori、移除 `ctx.mixin` 调用来避免。如果你重新引入未修改的上游代码，这个问题会回来。

### service has been registered

当一个服务在相同隔离域内被注册两次时出现。

常见原因是 `life`、`message`、`satori` 等没有正确隔离。

## 第 41 章 沙盒排障

沙盒报错通常来自 Hub 与 Nerve 之间的路由：

- `no Life registered as 'xxx'`：Nerve 没有注册，或注册后被销毁。
- 前端看不到 Life：Hub 没有收到 Nerve 注册。
- 消息发出但 Life 不回：Cortex 没有安装，或 MessageService 没有可用 Bot。

排查顺序是：先确认 Nerve 注册，再确认 Bot 创建，再确认 Cortex 收到事件，最后确认回复通道。

## 第 42 章 上游与依赖维护

仓库将 Satori v5 代码 vendored 到 `vendor/satorijs/`。

这意味着：

- 上游更新不会自动进入。
- 你可以本地修改，但下次同步时要小心。
- 任何对 Satori 的修改都应记录原因，避免丢失。

当前最重要的本地修改是移除 `mixin`，并把 `ctx.bots` 改为 `ctx.satori.bots`。

## 第 43 章 数据与记忆

当前 Life 的记忆是内存 stub，重启后不会保留。

未来会接入真正的持久化后端。设计上，Life 记忆必须独立于 Cortex 状态，因为更换 Cortex 不应丢失身份记忆。

---

# 第十卷：从熟练到精通

## 第 44 章 精通的标准

对 Athena Harness 的掌握程度，可以用以下能力划分：

### 入门

- 能解释 Life、Cortex、Nerve。
- 能描述一个消息从平台到回复的完整路径。
- 知道仓库中的包分别负责什么。

### 熟练

- 能解释隔离的必要性。
- 能理解 `message`、`life`、`satori` 等服务的依赖关系。
- 能定位常见运行错误。
- 能理解沙盒 Hub 与 Nerve 的分工。

### 精通

- 能设计新的 Cortex。
- 能设计新的 Nerve 或能力服务。
- 能诊断 Cordis 隔离、代理身份、事件过滤等底层问题。
- 能在不破坏隔离的前提下扩展多 Life 系统。
- 能判断一个设计是否让项目退化成普通聊天机器人框架。

## 第 45 章 设计上的“退化测试”

判断 Athena Harness 是否失去灵魂，可以看以下几点：

1. Life 是否只是配置文件。
2. Cortex 是否只是事件订阅插件。
3. 非 IM 能力是否总是“二等公民”。
4. 核心流程是否重新变成“消息进，消息出”。
5. 记忆和人设是否变成静态文本。

如果这些开始成立，项目就在退化成另一个 Koishi 或 AstrBot。

## 第 46 章 如何深入阅读源码

不要按字母顺序读源码，而应该按链路读：

1. 先读 `@athena-ai/plugin-life`，理解 Life 的边界。
2. 再读 `@athena-ai/capability-message`，理解能力封装。
3. 再读 `@athena-ai/cortex-chat`，理解 Cortex 如何消费能力。
4. 再读 `@athena-ai/adapter-onebot`，理解 Nerve 如何接入。
5. 再读沙盒 Hub 与 Nerve，理解一个完整的分层示例。
6. 最后回到 `multi-life-isolation-design.md`，用实现验证设计。

## 第 47 章 如何判断一个功能该放在哪层

每次遇到新需求，先问它属于哪一层：

- 属于“这个存在是谁”？放到 Life。
- 属于“这个存在如何决策”？放到 Cortex。
- 属于“这个存在如何接触世界”？放到 Nerve 或能力服务。
- 属于“页面、日志、通用工具”？放到根上下文或基础设施插件。

这个判断比任何 API 细节都重要。

## 第 48 章 未来方向

项目正在从“聊天链路”走向“完整数字生命运行时”。值得关注的方向包括：

- 真正的 LLM 认知循环。
- 持久化记忆。
- 世界型 Cortex 与自主节奏。
- 更多非 IM Nerve。
- 更完整的 Instance 配置。
- 更成熟的工具注册与权限模型。

---

# 术语表

## 基础术语

| 术语 | 含义 |
|---|---|
| Life | 数字生命的身份层，持续存在 |
| Cortex | 数字生命的生存策略，整体可替换 |
| Nerve | 数字生命与世界之间的通道 |
| Capability | 能力契约，例如消息能力 |
| Instance | 一个数字生命的完整声明式组装 |
| Persona | Life 的人设信息 |

## Cordis 术语

| 术语 | 含义 |
|---|---|
| Context | 插件运行的上下文 |
| Service | 注册在上下文上的具名服务 |
| Fiber | 一次插件安装的生命周期单元 |
| Inject | 声明插件依赖的服务 |
| Isolate | 为服务名创建私有符号，形成隔离域 |

## Satori 术语

| 术语 | 含义 |
|---|---|
| Session | 一次平台事件的标准化描述 |
| Bot | 一个平台连接实例，可视为一个 Nerve |
| Element | 富文本内容模型 |
| Adapter | 负责平台连接和事件转换的插件 |

## 沙盒术语

| 术语 | 含义 |
|---|---|
| Sandbox Hub | 全局沙盒服务，拥有页面与 WebSocket 路由 |
| Sandbox Nerve | 每个 Life 内部的沙盒桥 |
| Sandbox Bot | 沙盒世界中的虚拟 Bot |
| Sandbox Messenger | 把回复送回浏览器的消息通道 |

---

# 附录：当前仓库地图

## 核心包

| 包 | 目录 | 角色 |
|---|---|---|
| `@athena-ai/protocol` | `packages/protocol/` | 类型、Cortex 抽象、沙盒协议 |
| `@athena-ai/core` | `packages/core/` | 当前 prelude 壳 |
| `@athena-ai/plugin-life` | `plugins/life/` | Life 运行时 |
| `@athena-ai/capability-message` | `plugins/capability-message/` | 消息能力 |
| `@athena-ai/cortex-chat` | `plugins/cortex-chat/` | 聊天 Cortex |
| `@athena-ai/adapter-onebot` | `plugins/adapter-onebot/` | OneBot 适配器 |
| `@athena-ai/plugin-sandbox` | `plugins/sandbox/` | 沙盒 Hub |
| `@athena-ai/sandbox-nerve` | `plugins/sandbox-nerve/` | 沙盒 Nerve |

## 设计文档

| 文档 | 用途 |
|---|---|
| `design-philosophy-and-positioning.md` | 为什么它是数字生命框架 |
| `spirit-pulse-medium-domain-model.md` | 概念模型与三层工具模型 |
| `naming-and-package-architecture.md` | 命名、包结构与依赖规则 |
| `capability-message-design.md` | 消息能力的隔离设计 |
| `satori-capability-architecture.md` | Satori 如何成为能力实现 |
| `multi-life-isolation-design.md` | 多 Life 隔离的根因与最终方案 |

## 不建议继续学习的区域

`legacy/` 下的代码和旧 demo 配置属于历史存档。

它们可以帮助你理解“之前为什么失败”，但不应作为当前架构、命名或配置的权威来源。

---

## 结束语

Athena Harness 不是一个“回答问题的框架”，而是一个“让存在发生”的框架。

当你刚开始阅读时，先记住三件事：

1. Life 是身份。
2. Cortex 是活法。
3. Nerve 是世界。

当你读到这里时，你应该已经能够把这三件事翻译成服务、隔离、事件、插件和沙盒，也应该知道当系统出错时该检查哪一层。

真正的精通不在于背下所有包名，而在于面对一个新需求时，能准确回答：这个功能属于 Life、Cortex、Nerve，还是基础设施。
