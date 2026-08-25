# 03 · Nerve 事件与持久化

> Cortex 开发者参考手册。描述"事件如何从世界进入 Cortex、如何存储、如何被 LLM 消费"的推荐做法。
>
> 前置依赖：先读 [01-context-construction.md](./01-context-construction.md) 和 [02-multi-scene-attention.md](./02-multi-scene-attention.md)。
>
> 不是强制协议——Cortex 内部自治，可完整替换。
> 这里记录的是经验、理由和推荐默认值，不是规定。

---

## Nerve 协议总览

### 命名

| 概念     | 名称         | 含义                                |
| -------- | ------------ | ----------------------------------- |
| 子系统   | Nerve        | Life 与世界的双向通道（三原语之一） |
| 具体实体 | Body         | Life 在某个平台的化身               |
| 管理器   | NerveService | 管理所有 Body 的注册表，低频使用    |

三原语的实例化对照：

| 原语   | 回答           | 实例模式                            |
| ------ | -------------- | ----------------------------------- |
| Life   | "我是谁"       | 单例（一个 Life 一个 `ctx.life`）   |
| Cortex | "我如何活着"   | 单例（一个 Life 一个 `ctx.cortex`） |
| Nerve  | "我存在于何处" | 多实例（一个 Life 有多个 Body）     |

### 与 Satori 的关系

本协议参考了 Satori v5 的设计：统一 Session 信封、Bot/Adapter 抽象、生命周期管理、IM 平台最小原语等。但 Athena 实现自己的协议，不继承 Satori。

### 为什么不继续使用 Satori

1. **改造幅度接近重写** — 拆 Event 接口、拆 Methods、删 Bot IM 方法、重组 protocol 包……补丁数量已经超过了合理范围
2. **术语和心智模型不同** — Satori 是 "Universal Messenger Protocol"，而 Nerve 是 "Life 与世界的接触面"。继续用 Satori 的命名会持续产生认知摩擦
3. **不需要兼容 Satori 生态** — Athena 不是 Koishi，不需要跑 Koishi 插件。IM adapter 迁移是机械工作，核心稳定后再做
4. **避免变成另一个 Koishi** — 沿用 IM 平台那一套设计，未来还可能走回 Koishi 的路

✅ **已实现（2026-08-25）**：Satori 的具体 IM adapter 已迁移为 Nerve adapter（`nerve-onebot`），vendor/satorijs 与 capability-message 已删除。迁移确认为机械转换，见 [05-lessons-learned.md](../05-lessons-learned.md) §14。

---

## Body

**Body 是 Life 在某个平台的化身。**

一个 Life 可以有多个 Body——一个在 QQ、一个在 Discord、一个在 Minecraft 世界。每个 Body 是 Nerve 子系统中的一个具体连接实例。

### 基类设计

Body 基类极简——只负责连接管理和事件分发，不携带任何领域方法：

```typescript
export abstract class Body<T = any> {
  selfId: string;
  platform: string;
  status: Status;

  constructor(
    public ctx: Context,
    public config: T,
  ) {}

  /** 建立与平台的连接 */
  abstract connect(): Promise<void>;
  /** 断开连接 */
  abstract disconnect(): Promise<void>;

  /** 分发事件到 Cordis 事件总线 */
  dispatch(event: NerveEvent): void;

  /** 创建事件信封的工厂方法 */
  event(partial?: Partial<NerveEvent>): NerveEvent;

  /** 唯一标识：`${platform}:${selfId}` */
  get sid(): string;
}
```

**没有 `sendMessage`、`getChannel` 等任何 IM 方法。** 这些由 `protocol-im` 通过 declaration merging 扩展到 Body 上。

### 领域方法通过类型扩展声明

```typescript
// @athena-ai/protocol-im 扩展
declare module "@athena-ai/nerve" {
  interface Body {
    sendMessage(channelId: string, content: Element[], options?: SendOptions): Promise<Message[]>;
    getMessage(channelId: string, messageId: string): Promise<Message>;
    getChannel(channelId: string): Promise<Channel>;
    // ...
  }
}

// @athena-ai/nerve-minecraft 扩展
declare module "@athena-ai/nerve" {
  interface Body {
    moveToPosition(position: Vec3): Promise<void>;
    placeBlock(position: Vec3, type: string): Promise<void>;
    getInventory(): Promise<Inventory>;
  }
}
```

Cortex 通过 import 哪个包的类型来获得对应的 API 类型。这是编译时的自我承诺："我接收并处理这些事件，我知道某个 Body 有哪些接口可用。"

---

## NerveEvent

> **历史演进记录（2026-08-25）**：本节描述的 `NerveEventMap` / plain-interface 方案已被 **Session 信封** 取代——运行时统一用 `Session`（core）传播，protocol-im 用 `defineAccessor` 把 IM 访问器挂到 `Session.prototype`，`NerveEvent` 类型已删除，具体事件接口（`IMMessageEvent` 等）`extends Session` 收窄。事件签名只在 `cordis.Events` 声明。本节保留作设计历程参考，以代码为准。

NerveEvent 是所有从 Nerve 进入 Cortex 的事件的统一信封。

### 设计：plain interface + body 引用

```typescript
export interface NerveEvent {
  /** 事件类型 discriminant */
  type: string;
  /** 事件唯一 ID（幂等去重） */
  id: string;
  /** 接收此事件的 Body 标识 */
  selfId: string;
  /** 平台 / nerve 类型标识 */
  platform: string;
  /** 事件发生时间 */
  timestamp: number;
  /** 接收此事件的 Body 引用（非序列化） */
  body: Body;
}
```

这是最小公共字段。没有 `channelId`、`guildId`、`messageId`——这些全部由 `protocol-im` 扩展。

### 为什么是 plain interface 而不是 class

- 事件本质是数据，不是行为载体
- 序列化时自然忽略 `body`（函数引用）
- 不需要原型链和 accessor trick
- Cordis 的事件 filter 通过 dispatch 时手动设置 tracker 实现，不依赖 class

### NerveEventMap：类型收窄

各 nerve 包通过 declaration merging 注册自己的事件类型：

```typescript
// @athena-ai/nerve 核心
export interface NerveEventMap {}

// protocol-im 扩展
declare module "@athena-ai/nerve" {
  interface NerveEventMap {
    "message-created": IMMessageEvent;
    "message-deleted": IMMessageDeletedEvent;
    "message-updated": IMMessageUpdatedEvent;
  }
}

// nerve-minecraft 扩展
declare module "@athena-ai/nerve" {
  interface NerveEventMap {
    "minecraft/chat": MinecraftChatEvent;
    "minecraft/block-placed": BlockPlacedEvent;
    "minecraft/entity-moved": EntityMovedEvent;
  }
}
```

事件监听时自动收窄类型：

```typescript
// IM 事件——channelId, message 等为必填
ctx.on("message-created", (event) => {
  event.channelId; // string
  event.message; // Message
  event.userId; // string
});

// Minecraft 事件——position, worldId 等为必填
ctx.on("minecraft/block-placed", (event) => {
  event.position; // Vec3
  event.blockType; // string
});
```

各具体事件类型 extends NerveEvent，将公共 optional 字段收窄为必填：

```typescript
interface IMMessageEvent extends NerveEvent {
  type: "message-created";
  channelId: string;
  userId: string;
  messageId: string;
  message: Message;
  channel: Channel;
  user: User;
}
```

---

## 协议分层

### 包结构

```
@athena-ai/nerve              — Body 基类 + NerveEvent + NerveEventMap + NerveService
@athena-ai/protocol-im        — IM 公因式协议（类型 + Body 方法扩展 + 事件注册 + 运行时）
@athena-ai/nerve-onebot       — OneBot adapter（依赖 nerve + protocol-im）
@athena-ai/nerve-qq           — QQ adapter（依赖 nerve + protocol-im）
@athena-ai/nerve-minecraft    — Minecraft adapter（依赖 nerve，自包含协议）
```

### protocol-im 的定位

IM 是特例——多种 IM 平台（QQ、Discord、Telegram 等）高度同构：

- 操作同构：都是收发消息
- 实体同构：都有 channel、user、message
- 开发者需求同构：Cortex 不想关心是 QQ 还是 Discord

`protocol-im` 是这些 IM adapter 的公因式。Cortex 只需 import protocol-im，无需依赖具体 nerve adapter。

protocol-im 提供：

1. **类型**：Message、Channel、User、Guild、Element 等 IM 实体
2. **类型扩展**：NerveEvent 的 IM 字段、Body 的 IM 方法
3. **事件注册**：message-created 等到 Cordis Events
4. **运行时**：Body.prototype 上的 IM 默认实现（sendMessage 等）
5. **工具函数**：MessageEncoder 基类、Element 解析等

### 非 IM 场景

非 IM 领域差异大（Minecraft vs Terraria vs Roblox），不预先提炼抽象。每个 nerve 包自包含协议和实现。

**何时提炼 protocol 层：**

1. 存在 2+ 个 adapter 共享同一组核心操作和实体
2. 这组核心操作覆盖 Cortex 使用场景的 >80%
3. 差异可被 optional 字段或 adapter-specific 扩展吸收

三个条件同时满足才值得提炼。Protocol 层是 adapter 之间的公因式，按需提取，不预先规划。

### Cortex 的平台无关性

Cortex 通过 import 类型来声明自己处理哪些事件：

```typescript
// cortex-chat：处理 IM 事件
import type {} from "@athena-ai/protocol-im";

// cortex-world：处理 Minecraft 事件
import type {} from "@athena-ai/nerve-minecraft";
```

这是编译时约束，不是运行时依赖注入。Cortex 不直接依赖具体 adapter 包。

---

## 持久化

### 设计原则

1. **只有 IM 消息值得持久化**——其他事件即发即忘，仅存在于消费者内存
2. **两种独立的持久化**：消息归档（客观记录）和工作区（主观认知过程）
3. **工作区是 LLM 上下文的 source of truth**——不从归档重建

类比：手机里的聊天记录是「消息归档」，你脑子里对对话的记忆是「工作区」。两者独立，内容可能重叠但格式和用途完全不同。

---

### IM 消息归档（message-store）

message-store 监听 IM 事件（`message-created`、`send`），自动归档消息实体。

#### StoredMessage 形态

```typescript
interface StoredMessage {
  id: string; // 消息平台 ID（主键）
  platform: string; // 来源平台
  channelId: string; // 所属频道
  userId: string; // 发送者
  elements: Element[]; // 结构化内容
  timestamp: number; // 发送时间
  replyTo?: string; // 引用的消息 ID
}
```

判断是否是 Life 自己发的：`userId === body.selfId`。不需要额外 `isSelf` 字段。

#### 索引策略

- `platform + channelId + timestamp`：focus 展开时按频道读取历史
- `platform + userId + timestamp`：跨频道查某人的消息（旁路读取场景）

#### 只存 Message 实体，不存 NerveEvent

- 持久化目的是"恢复对话历史"，不是"重放事件"
- Message 是稳定实体（有全局 ID），同一条消息只存一份
- Event 是瞬时通知（created、updated、deleted 可能对应同一条 message）

---

### Workspace（LLM 上下文）

Workspace 存储的是 LLM 调用的完整输入输出——主心智的认知过程。

#### WsMessage 类型

在 AI SDK 的 `ModelMessage` 基础上扩展极薄的元数据：

```typescript
import type { AssistantModelMessage, SystemModelMessage, ToolModelMessage, UserModelMessage, LanguageModelUsage } from "ai";

/** 所有 workspace 消息共享的元数据 */
export interface MessageMeta {
  id: string;
  ts: number;
}

export interface WsUserMessage extends MessageMeta, UserModelMessage {}

export interface WsSystemMessage extends MessageMeta, SystemModelMessage {}

export interface WsAssistantMessage extends MessageMeta, AssistantModelMessage {
  usage?: LanguageModelUsage;
  finishReason?: string;
}

export interface WsToolMessage extends MessageMeta, ToolModelMessage {}

export type WsMessage = WsUserMessage | WsSystemMessage | WsAssistantMessage | WsToolMessage;
```

设计要点：

- `id` + `ts`：最小公共元数据，用于去重和时序
- `usage` + `finishReason`：只在 assistant message 上，记录 LLM 调用的结果信息
- 直接 extends AI SDK 原生类型，不额外造类型
- `providerOptions` 自然保留（来自 AI SDK 原生字段）

#### 存储格式：JSONL

每行一个 `WsMessage` 的 JSON：

```jsonl
{"id":"m_1","ts":1692000000,"role":"system","content":"你是..."}
{"id":"m_2","ts":1692000001,"role":"user","content":[{"type":"text","text":"你好"}]}
{"id":"m_3","ts":1692000002,"role":"assistant","content":[{"type":"text","text":"你好！"}],"usage":{"promptTokens":50,"completionTokens":12,"totalTokens":62},"finishReason":"stop"}
```

- 写入：`JSON.stringify(msg) + '\n'` append
- 读取：逐行 `JSON.parse` 得到 `WsMessage[]`
- 检查点时清空文件

#### 写入时序

```
1. 事件到达 Cortex
2. Cortex 将事件转换为 WsMessage（user/system message）
3. Append 到 workspace（持久化）
4. 从 workspace 读取全部 WsMessage → 转为 ModelMessage[]
5. 调用 LLM（streamText）
6. LLM 返回结果转为 WsMessage（assistant/tool message）
7. Append 到 workspace（持久化）
8. 如果有后续 step，回到 4
```

**关键约束：请求 LLM 时只能从 workspace 读取，不能从 message-store 逐条重建。**

#### toModelMessage 转换

发送给 LLM 时，剥掉我们加的元数据，保留 AI SDK 原生字段：

```typescript
function toModelMessage(ws: WsMessage): ModelMessage {
  // 剥掉 id, ts, usage, finishReason
  // 保留 role, content, providerOptions
  const { id, ts, ...rest } = ws;
  if (rest.role === "assistant") {
    const { usage, finishReason, ...msg } = rest;
    return msg;
  }
  return rest;
}
```

---

### Checkpoint

检查点是帧的快照，记录"此刻 LLM 上下文的前缀部分"。

```typescript
interface Checkpoint {
  id: string;
  ts: number;
  focusSceneId: string | null;
  /** 帧部分的 messages（system prompt + 压缩条目 + awareness + focus context） */
  frameMessages: ModelMessage[];
  /** 压缩条目文本（主心智认知轨迹） */
  compaction: string | null;
}
```

#### 触发时机

同 [cookbook 02](./02-multi-scene-attention.md) 的检查点触发条件：

- Focus 切换
- 上下文压缩完成
- 系统重启 / 冷启动

#### 检查点流程

1. 压缩当前 workspace 中的认知轨迹 → 生成 compaction
2. 组装新的 frameMessages（稳定区 + 新帧）
3. 写入 Checkpoint 文件
4. 清空 workspace.jsonl

#### 恢复流程

```
LLM input = Checkpoint.frameMessages + workspace.map(toModelMessage)
```

完整、确定、无重建逻辑。

---

### 文件组织

```
cortex-state/
  checkpoint-latest.json          // 最近的 checkpoint
  workspace.jsonl                  // 当前 workspace（append-only）
```

---

## 两个 store 的关系

|          | message-store                    | workspace                      |
| -------- | -------------------------------- | ------------------------------ |
| 存什么   | 原始 IM 消息（Element[]）        | AI SDK ModelMessage + 薄元数据 |
| 来源     | 自动监听事件写入                 | Cortex 主动写入                |
| 谁读     | Cortex（focus 展开、旁路读取）   | Cortex（组装 LLM 请求）        |
| 索引     | platform + channelId + timestamp | 追加顺序（JSONL 行序）         |
| 去重     | 按 messageId                     | 不去重（追加式）               |
| 内容格式 | 平台消息原文                     | 格式化后的 LLM 内容            |
| 生命周期 | 长期保留                         | 每个检查点周期清空             |

**message-store 是档案馆，workspace 是工作笔记本。**

一条用户消息在两处各出现一次：

1. message-store：作为客观消息记录（`StoredMessage`）
2. workspace：作为 LLM 输入（`WsUserMessage`，可能被格式化、附加 awareness 上下文）

两者独立存储，不互相派生。Focus 展开时从 message-store 读历史 → 格式化为帧 → 写入 Checkpoint。之后这些内容从 Checkpoint 读，不再回 message-store。

---

## 否决方案

### 继续使用 / 改造 Satori

拆 Event 接口、拆 Methods、删 Bot IM 方法、重组 protocol 包——改动量接近重写。不如实现自己的稳定协议，术语和心智模型一致，避免持续的认知摩擦。

### 统一 NerveEvent 信封 + per-kind 持久化策略

曾考虑在 NerveEvent 上携带 `retention: "persistent" | "ephemeral"` 标记，让不同类型的事件有不同的持久化策略。

否决理由：只有 IM 消息值得持久化。其他事件即发即忘。不需要通用的持久化策略机制——这是过度设计。

### Block 概念（perception-protocol）

`.specify/specs/perception-protocol-and-session-design.md` 中的 Block 试图将异构事件预处理成统一的 LLM 可消费格式——Block 同时是持久化单元和 LLM 输入单元。

否决理由：混淆了两个关注点。"事件本身"（发生了什么）应该如实记录；"LLM 呈现"（模型看到什么）应该在组装工作区时决定，不在存储时决定。

### 从 message-store 逐条重建 LLM messages

曾考虑不存 workspace，每次调用 LLM 时从 message-store 读取原始消息并重新格式化为 ModelMessage[]。

否决理由：

1. **不确定性** — 格式化逻辑可能变化，导致同一段历史在不同时间生成不同 messages
2. **不完整** — workspace 中包含 tool calls、tool results、system 注解等 message-store 中根本不存在的内容
3. **性能** — 每次调用都要读取 + 转换，而 workspace 是顺序读取

---

## 待定事项

以下问题尚未决策，留待后续讨论：

1. **NerveService 的具体 API** — Body 注册/注销/查找的接口设计

2. **Body 的 Cordis 集成** — Body 如何注册到 Cordis scope？是否需要类似 Satori 的 `bot-connect` / `bot-disconnect` 事件？

3. **protocol-im 的具体实体类型** — Message、Channel、User、Guild 等的字段定义（可参考 Satori protocol 但不必完全一致）

4. **Element 格式** — ✅ **已定**：复用 `@cordisjs/element`（npm 发布版），protocol-im 提供 `at`/`image`/`quote` 等工厂函数

5. **message-store 的存储后端** — SQLite？文件系统？需要权衡查询能力和部署复杂度

6. **WsMessage 的 id 生成策略** — 使用 AI SDK 的 `generateId()` 还是自己的短 ID 生成器？

7. **大型 tool result 的处理** — workspace 中 tool result 可能很大（如返回大量 JSON），是否需要在写入时做截断或引用？

8. **Checkpoint 历史保留策略** — 只保留最近一个？保留 N 个？保留到什么条件时清理？

---

## 参考来源

- ~~Satori v5（`vendor/satorijs/`）~~ —— 已移除；Bot/Adapter/Session 抽象的历史参考见 `references/`
- YesImBot agent-runtime（`/home/workspace/YesImBot/packages/agent-runtime/src/message.ts`）—— WsMessage 设计的直接参考
- AI SDK v7（`@ai-sdk/provider-utils`）—— ModelMessage 类型定义
- [01-context-construction.md](./01-context-construction.md) —— 三块模型
- [02-multi-scene-attention.md](./02-multi-scene-attention.md) —— 检查点语义、workspace 生命周期
