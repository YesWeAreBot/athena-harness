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
export abstract class Body<T = unknown> {
  public selfId!: string;
  public abstract platform: string;
  public status: Status = "offline";

  constructor(
    public ctx: Context,
    public config: T,
  ) {}

  /** 建立与平台的连接 */
  abstract connect(): Promise<void>;
  /** 断开连接 */
  abstract disconnect(): Promise<void>;

  /** 创建 Session 信封的工厂方法 */
  session(event: Partial<Event> = {}): Session;

  /** 分发 Session 到 Cordis 事件总线（经 internal/session 归一化） */
  dispatch(session: Session): void;

  /** 唯一标识：`${platform}:${selfId}` */
  get sid(): string;

  /** Cordis Service 生命周期：自动注册进 ctx.nerve，dispose 时注销 */
  *[Service.init](): Generator<unknown, void, unknown>;
}
```

**没有 `sendMessage`、`getChannel` 等任何 IM 方法。** 这些由 `IMBody` 子类（`protocol-im`）提供。

### IM 能力通过 IMBody 继承

IM adapter 不直接继承 `Body`，而是继承 `IMBody`：

```typescript
// @athena-ai/protocol-im
export abstract class IMBody<C = unknown> extends Body<C> {
  /** 运行时能力检测 */
  supports(name: string): boolean;

  /** 默认实现：sendMessage 委托 createMessage */
  async sendMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<string[]>;
  async sendPrivateMessage(userId: string, content: Fragment, guildId?: string, options?: SendOptions): Promise<string[]>;

  /** adapter 必须实现 */
  abstract createMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<Message[]>;
  abstract createDirectChannel(userId: string, guildId?: string): Promise<Channel>;
}
```

`IMBody` 通过 interface-class merge 声明完整的 `IMMethods` 表面（`getMessage`、`getGuild`、`getChannel` 等）。adapter 只实现它支持的子集——未实现的方法在运行时为 `undefined`，通过 `supports()` 检测。

### BodyRegistry：类型联合

每个 protocol/adapter 包通过 declaration merging 向 `BodyRegistry` 注入自己的 Body 类型：

```typescript
// @athena-ai/protocol-im
declare module "@athena-ai/protocol" {
  interface BodyRegistry {
    im: IMBody;
  }
}

// @athena-ai/nerve-onebot
declare module "@athena-ai/protocol" {
  interface BodyRegistry {
    onebot: OneBotBody;
  }
}
```

`NerveService.get(sid)` 返回 `AnyBody`——所有注册类型的联合。Cortex 通过 `platform` 字面量或 `instanceof` 收窄到具体 Body 类型。

### 非 IM Body

非 IM 场景（Minecraft、音频等）直接继承 `Body`，定义自己的方法和事件。不往 `Body` 基类上 merge 领域方法：

```typescript
// nerve-minecraft（示例）
export abstract class MinecraftBody extends Body<MinecraftConfig> {
  platform = "minecraft" as const;
  abstract moveToPosition(position: Vec3): Promise<void>;
  abstract getInventory(): Promise<Inventory>;
}
```

---

## Session 信封与事件类型

### Session：统一运行时信封

所有从 Nerve 进入 Cortex 的事件都以 `Session` 实例传播。Session 是运行时信封，`session.event` 持有数据载荷，`session.body` 引用来源 Body。

```typescript
export class Session {
  /** 进程内唯一序号 */
  public sn: number;
  /** 来源 Body */
  public readonly body: Body<unknown>;
  /** 原始事件载荷 */
  public event: Event;

  constructor(body: Body<unknown>, event: Partial<Event>);

  get sid(): string; // `${platform}:${selfId}`
}
```

### Event：数据载荷接口

```typescript
export interface Event {
  type: string; // 事件类型 discriminant
  id: string; // 唯一 ID（幂等去重）
  selfId: string; // 接收此事件的 Body 标识
  platform: string; // 平台标识
  timestamp: number; // 发生时间（ms）
  _type?: string; // internal 子事件类型
  _data?: unknown; // internal 子事件载荷
}
```

这是最小公共字段。`channelId`、`guildId`、`message` 等 IM 字段由 `protocol-im` 通过 declaration merging 扩展到 `Event` 接口上。

### 访问器模式（defineAccessor）

Session 的派生字段（`channelId`、`userId`、`content`、`isDirect` 等）不是独立存储的属性，而是挂在 `Session.prototype` 上的访问器，从 `session.event` 的嵌套对象推导：

```typescript
// protocol 基础访问器
defineAccessor(Session.prototype, "type", ["event", "type"]);
defineAccessor(Session.prototype, "selfId", ["event", "selfId"]);
defineAccessor(Session.prototype, "platform", ["event", "platform"]);
defineAccessor(Session.prototype, "timestamp", ["event", "timestamp"]);

// protocol-im 追加的 IM 访问器
defineAccessor(Session.prototype, "channelId", ["event", "channel", "id"]);
defineAccessor(Session.prototype, "userId", ["event", "user", "id"]);
defineAccessor(Session.prototype, "guildId", ["event", "guild", "id"]);
defineAccessor(Session.prototype, "messageId", ["event", "message", "id"]);
// ... 以及 content、isDirect 等计算访问器
```

**adapter 只需填嵌套数据对象**（`channel`/`user`/`guild`/`message`），所有派生字段自动推导。

### 事件类型：cordis.Events 声明 + 交叉类型收窄

事件签名**只在 `cordis.Events` 中声明一份**，不维护平行事件映射表（架构不变式 #12）。

具体事件类型是 `Session &` 交叉类型，将可选字段收窄为必填：

```typescript
// 基础 IM 事件
export type IMEvent = Session & {
  channelId: string;
  userId: string;
  channel: Channel;
  user: User;
  body: IMBody;
};

// 消息事件
export type IMMessageEvent = IMEvent & {
  type: "message-created";
  messageId: string;
  message: Message;
  content: string;
};
```

消费方获得精确类型：

```typescript
ctx.on("message-created", (event) => {
  event.channelId; // string（必填）
  event.message; // Message（必填）
  event.body; // IMBody（可直接 sendMessage）
});
```

### 事件分发路径

```
adapter → body.session({ type, channel, user, message, ... })
        → body.dispatch(session)
        → ctx.emit("internal/session", session)       ← 统一归一化入口
        → NerveService 归一化器
            internal 类型 → emit(_type, _data, body)  ← 平台子事件
            其余 → body.ctx.emit(session.type, session) ← 从 Body 所属 ctx 发射，保持 Life 隔离
        → cordis.Events 消费者（ctx.on("message-created", ...)）
```

---

## 协议分层

### 包结构

```
@athena-ai/protocol           — Body 基类 + Session + Event + NerveService + BodyRegistry + defineAccessor
@athena-ai/protocol-im        — IMBody + IMMethods + IM 实体类型 + Session 访问器 + cordis.Events 声明 + MessageEncoder + WsClient
@athena-ai/nerve-onebot       — OneBot adapter（依赖 protocol + protocol-im）
@athena-ai/nerve-qq           — QQ adapter（依赖 protocol + protocol-im）
@athena-ai/nerve-minecraft    — Minecraft adapter（依赖 protocol，自包含协议）
```

### protocol-im 的定位

IM 是特例——多种 IM 平台（QQ、Discord、Telegram 等）高度同构：

- 操作同构：都是收发消息
- 实体同构：都有 channel、user、message
- 开发者需求同构：Cortex 不想关心是 QQ 还是 Discord

`protocol-im` 是这些 IM adapter 的公因式。Cortex 只需 import protocol-im，无需依赖具体 nerve adapter。

protocol-im 提供：

1. **类型**：Message、Channel、User、Guild 等 IM 实体
2. **IMBody 类**：继承 Body，通过 interface-class merge 声明完整 IM 方法表面
3. **Session 访问器**：`defineAccessor` 把 IM 派生字段（`channelId`/`userId`/`content`/`isDirect` 等）挂到 `Session.prototype`
4. **事件注册**：`cordis.Events` 中声明 `message-created`、`guild-member-added` 等完整 IM 事件集
5. **工具函数**：MessageEncoder 基类、WsClient、Element 工厂

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

#### 只存 Message 实体，不存 Session

- 持久化目的是"恢复对话历史"，不是"重放事件"
- Message 是稳定实体（有全局 ID），同一条消息只存一份
- Session 是瞬时通知（created、updated、deleted 可能对应同一条 message）

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

### 统一 Session 信封 + per-kind 持久化策略

曾考虑在 Event 上携带 `retention: "persistent" | "ephemeral"` 标记，让不同类型的事件有不同的持久化策略。

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

1. **protocol-im 的具体实体类型** — ✅ **已定**：Message、Channel、User、Guild 等已在 `packages/protocol-im/src/types.ts` 中定义，字段参考 Satori 但独立维护

2. **Element 格式** — ✅ **已定**：复用 `@cordisjs/element`（npm 发布版），protocol-im 提供 `at`/`image`/`quote` 等工厂函数

3. **message-store 的存储后端** — ✅ **已定**：使用 `@cordisjs/plugin-database`（Cordis 标准 ORM），配合 `@cordisjs/plugin-database-sqlite` 驱动。表名 `athena.messages`，复合主键 `[platform, id]`，索引 `[platform, channelId, timestamp]` 和 `[platform, userId, timestamp]`。实现见 `plugins/message-store/src/index.ts`

4. **WsMessage 的 id 生成策略** — ✅ **已定**：使用 AI SDK 的 `generateId()`（来自 `ai` 包）。统一依赖一个 ID 生成器，无需自建。实现见 `plugins/cortex-chat/src/workspace.ts` 的 `createWsMessage()`

5. **大型 tool result 的处理** — workspace 中 tool result 可能很大（如返回大量 JSON），是否需要在写入时做截断或引用？

6. **Checkpoint 历史保留策略** — ✅ **已定（初始策略）**：只保留最近一个（`checkpoint-latest.json`）。当前阶段无需历史回溯；未来如需多版本保留可扩展为 `checkpoint-{id}.json` + 索引文件

---

## 参考来源

- ~~Satori v5（`vendor/satorijs/`）~~ —— 已移除；Bot/Adapter/Session 抽象的历史参考见 `references/`
- YesImBot agent-runtime（`/home/workspace/YesImBot/packages/agent-runtime/src/message.ts`）—— WsMessage 设计的直接参考
- AI SDK v7（`@ai-sdk/provider-utils`）—— ModelMessage 类型定义
- [01-context-construction.md](./01-context-construction.md) —— 三块模型
- [02-multi-scene-attention.md](./02-multi-scene-attention.md) —— 检查点语义、workspace 生命周期
