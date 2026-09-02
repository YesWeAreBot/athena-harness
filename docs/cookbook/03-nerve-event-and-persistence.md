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
        → NerveService 归一化器（只有拥有该 Body 的那个 NerveService 处理）
            internal 类型 → emit(session, _type, _data, body)  ← 平台子事件
            其余 → body.ctx.emit(session, session.type, session)
        → cordis.Events 消费者（ctx.on("message-created", ...)）
```

**Cordis 事件是进程级广播，"从 Body 所属 ctx 发射"本身并不产生隔离。** `emit` 只按事件名查 hook，不看 Context 树；`internal/session` 同样会到达进程内每一个 `NerveService`。所以隔离靠两件事同时成立：

1. 只有 `nerve` isolate 与 Body 相同的那个 `NerveService` 重新 emit（否则每多一个 Life 就多一次重复投递）；
2. 重新 emit 时把 Session 自己作为 `thisArg` 传入，`Session[Context.filter]` 把投递限制在该 Body 的 `nerve` isolate 内。

没有第 2 条，另一个 Life 的 Cortex 会归档并回复不属于它的消息——这是 Task 15 实测到的真实缺陷，不是理论风险。adapter 侧无需关心：`body.dispatch(session)` 就够了。

`NerveService` 的第一层所有权由 protocol 的 `LifeService` 保证：每个 Life 激活时在自己的 `nerve` isolate 下安装一个 NerveService，Life dispose 时一并释放。若两个 Life 共享同一个 `nerve` domain，第二个 Life 必须在启动时 fail fast；不能把 root 级单例当成可工作的 fallback。上面的 owning-domain check 与 filter 是事件总线上的第二层防线。

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

1. **只有 IM 消息值得跨进程持久化**——其他事件即发即忘，仅存在于消费者内存
2. **认知状态分三层**：message-store（客观消息归档，跨进程）+ checkpoint（帧区 + 压缩条目，跨进程）+ workspace（内存思考草稿，进程内）。没有 per-scene session store——scene 是寻址原语，不是认知分区
3. **工作区是 LLM 上下文的 source of truth**——不从归档重建
4. **路径属于 Life**：所有文件都在 `ctx.life.dataDir` 之下，进程里没有共享的全局状态目录

类比：手机里的聊天记录是「消息归档」，你保存的聊天摘要笔记是「checkpoint 压缩条目」，你正打了一半的回复草稿是「工作区」。

---

### IM 消息归档（message-store）

message-store 监听 IM 事件（`message-created`、`send`），无条件归档消息实体。它是 `plugins/cortex-chat` 的**内部模块**，不是独立 Cordis Service——归档服务于该 Life 的认知，没有第二个消费者需要它。

#### StoredMessage 形态

```typescript
interface StoredMessage {
  bodySid: string; // `${platform}:${selfId}`，Scene 身份的一半
  channelId: string; // Scene 身份的另一半
  messageId: string; // 平台消息 ID
  userId: string; // 发送者
  userName?: string;
  content: string; // canonical content（Athena element 语法）
  timestamp: number;
  replyTo?: string; // 引用的消息 ID
}
```

两个要点：

- **身份用 `bodySid`，不用 `platform`。** 一个 Life 可以拥有多个同平台 Body，它们可能访问同名 channel；只有 `bodySid + channelId` 是稳定的 Scene 身份。
- **只存 canonical `content: string`，不存第二份 `elements`。** `content` 与 element 树同源，可在边界用 `parse` / `toString` 互转（`<at id>`、`<quote id>`、媒体元素都在串里）。存两份就会有两个"真相"，且它们会漂移。adapter 有责任把入站与出站消息都归一化成这个串——`content` 为空的 `send` 事件会在档案里留下"这个 Life 什么都没说过"的假记录。

**OneBot 出站 canonical 规则**：encoder 同时维护平台 CQCode segment 与 canonical Athena Element segment。canonical 取 encoder 最终决定发送的语义，但在 OneBot 字段降级前表示：mention 保持 `<at id>`、媒体保持 `src`、段落/链接记录实际换行与文本语义、forward 记录 `<figure>/<message>`、文件上传记录 `<file src title>`。普通、forward、file 的 `send` 事件以及 `createMessage()` 返回实体都从同一 canonical segment 构造，禁止从 CQCode 反向猜测。

判断是否是 Life 自己发的：`userId === body.selfId`。不需要额外 `isSelf` 字段。

#### 表与索引

行上额外带一个内部 `lifeId` 列（不出现在公开类型里）：两个 Life 恰好持有同一个 `bodySid` 时不能共享行。

```text
primary: [lifeId, bodySid, messageId]
indexes: [lifeId, bodySid, channelId, timestamp, messageId]   // focus 展开、peek
         [lifeId, bodySid, userId, timestamp, messageId]      // 跨频道查某人
```

读取恒为时间升序，`limit` 保留**最近** N 条——只有一套分页语义。

#### 只存 Message 实体，不存 Session

- 持久化目的是"恢复对话历史"，不是"重放事件"
- Message 是稳定实体（有全局 ID），同一条消息只存一份
- Session 是瞬时通知（created、updated、deleted 可能对应同一条 message）

---

### Workspace（LLM 上下文）

Workspace 是主心智的**内存工作区**：LLM 调用的完整输入输出。它是 `ModelMessage[]`，由 `CortexChat` 持有，跨 turn 存活、重建时清空，**不跨进程持久化**。

#### 直接保留 AI SDK 原生消息

工作区不做中间格式投影、不加外层信封：

```typescript
// CortexChat 持有
public readonly workspace: ModelMessage[];

// AI SDK 输出与 step delta 原样追加
workspace.push(...result.response.messages);
workspace.push(...pendingToolDeltas);
// 重建时按覆盖长度清空前缀
workspace.splice(0, coveredLength);
```

- `ModelMessage` 的形状是 `{ role, content, providerOptions? }`；`providerOptions` 随消息传递，不提取到信封外
- `result.response.messages` 就是该 step 的 canonical `ModelMessage[]`：AI SDK 已把 part 级 `providerMetadata` 转成 `providerOptions`、把 tool 返回值包成 `ToolResultOutput`、把 `tool-error` 变成 `{ type: "error-text", value }`，并成对给出 assistant + tool message——整条存下来即可，不要自己从 `step.content` 重建
- `usage` 与 `finishReason` 是 runner 局部变量（用于 `TurnResult`），不挂在 message 上
- 用户消息进入工作区前经 `render.ts` 渲染为带元数据的 `<message from=... scene=... ts=... id=...>` 格式（见 cookbook 02 §Awareness）

#### 写入时序

```
1. 事件到达 Cortex
2. Cortex 归档到 message-store，路由为 user message（渲染元数据）或 awareness delta
3. 追加到 workspace（内存）
4. 组装请求：stable + frame + workspace（引用）
5. 调用 LLM（每 step 一次 generateText）
6. result.response.messages 原样 push 进 workspace
7. 该 step 的 pending tool delta（如 focusChange）在 response 之后追加
8. 如果有后续 step，回到 4
```

**关键约束：请求 LLM 时只能从 workspace 读取，不能从 message-store 逐条重建。**

---

### Checkpoint

检查点是**唯一的跨进程认知状态**，保存结构化帧区快照。帧区以结构化形式存放，渲染发生在请求组装时——不存渲染结果，避免下一轮压缩反解 XML。

```typescript
interface Frame {
  focus: SceneAddress | null; // 不是字符串 id：Scene 身份是结构化的
  history: ModelMessage[]; // 当前 focus 的历史
  lastFocusHistory: ModelMessage[]; // 切换前一代的认知轨迹（仅切换后一代存在）
}

interface Checkpoint extends Frame {
  version: 2;
  id: string;
  createdAt: number;
  compaction: string | null; // 压缩条目文本（主心智跨 Scene 的认知轨迹）
}
```

- version 从 1 升到 2，**不写兼容 loader**——旧文件加载直接抛错，由运维删除（开发阶段 checkpoint 可丢弃）
- `frameMessages` / `workspaceGeneration` 已删除：帧区由 `renderFrame()` 从 `Frame` 字段确定性投影，工作区不再持久化所以没有 generation
- 当前 persona、stable messages 与 tool payload 在每个 turn 按实时状态重新装配；checkpoint 只负责认知状态恢复，不承担 provider cache invalidation

#### 触发时机

同 [cookbook 02](./02-multi-scene-attention.md) 的检查点触发条件：

- 一个 turn 结束后 `frameFocus !== logicalFocus`（强制重建，与阈值无关）
- 一个 turn 结束后 workspace 超过 token 阈值
- idle 超时

focus 切换的时序限定：turn 内 frame 必须冻结，`switch_focus` 只移动 logical focus 并追加 focusChange delta，新 frame 在本 turn 结束后的 transition 里由 `promoteFocus()` 建立。

#### 检查点流程（重建事务）

串行顺序是恢复契约，不可交换：

```text
1. 代码剪枝当前 workspace → F' = prune(W)（reasoning 剔除、tool 对合并、失败原文保留）
2. 压缩器一次调用：C' = summarize(旧 history + 旧 lastFocusHistory + 旧 compaction)
3. 写入 Checkpoint 文件（临时文件 + rename，原子）
4. 替换内存中的 checkpoint
5. 成功后 workspace.splice(0, n) 清空
```

第 3 步之前的任何失败都保留旧 checkpoint、保留整个 workspace，并把原始错误抛回调用方（下一次重建重试）。focus 切换重建时 `history` 从 message-store 拉取新 focus 频道近期历史（`readScene` + `focusHistoryLimit`），`lastFocusHistory = prune(W)`。

#### 恢复流程

```
LLM input = stable（constitution + persona + compaction）+ renderFrame(checkpoint) + workspace
```

完整、确定、无重建逻辑。checkpoint 读取时只有"文件不存在"才返回空状态；损坏、权限、版本不兼容都必须报错，不能静默当成冷启动之外的任何东西——损坏的文件保留在原处，供人排查。重启后工作区为空，从 checkpoint 恢复帧，之后的事件重新累积。

---

### 文件组织

```
<ctx.life.dataDir>/cortex-chat/
  checkpoint.json                  // 最近的 checkpoint（临时文件 + rename 原子写）
```

`dataDir` 由 Life 解析（`path.resolve(config.dataDir, encodeURIComponent(id))`），所以多 Life 天然分开。**没有** `process.cwd()` 之下的共享目录。工作区在内存中，没有 workspace 文件；消息档案在数据库里，行上带内部 `lifeId` 列。

---

## 存储的关系：档案馆 + 认知状态

|          | message-store                        | checkpoint（帧区 + 压缩条目）                           | workspace（内存）                |
| -------- | ------------------------------------ | ------------------------------------------------------- | -------------------------------- |
| 回答什么 | 这个 Scene 发生过哪些原始消息？      | 主心智的持久化认知状态（跨进程）                        | 主心智此刻正在思考什么（进程内） |
| 存什么   | canonical `content` 串               | Frame（focus / history / lastFocusHistory）+ compaction | AI SDK `ModelMessage[]`          |
| 来源     | 自动监听事件写入                     | 重建事务（prune → summarize → save）                    | runner 追加 response 与 delta    |
| 谁读     | focus 展开、`peek_channel`、压缩输入 | 组装 LLM 请求前缀                                       | 组装 LLM 请求尾部                |
| 索引     | `lifeId + bodySid + channelId + ts`  | 单文件，按 Life 分目录                                  | 数组追加顺序                     |
| 生命周期 | 长期保留                             | 长期保留（每次重建替换）                                | 进程内跨 turn，重建时清空        |

**message-store 是档案馆，checkpoint 是跨进程的认知快照，workspace 是进程内的思考草稿。**

一条用户消息在多处各出现一次：

1. message-store：作为客观消息记录（`StoredMessage`）
2. workspace：作为 LLM 输入（渲染为带元数据的 `<message>`）
3. 重建后：剪枝形态进入 checkpoint 帧区，更早的内容以压缩条目形态继续存在

三者不互相派生。Focus 展开时从 message-store 读历史（`readScene`）拉取新 focus 的近期历史；当前 focus 的普通帧历史来自上一代工作区的剪枝，不从 message-store 重建整个历史。

**任一时刻，一段内容只存在于一个区**（外加 message-store 作为客观档案）。不存在 per-scene session store：scene 是寻址原语（`SceneAddress` / `SceneCursor`），不是认知分区。

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

3. **message-store 的存储后端** — ✅ **已定**：使用 `@cordisjs/plugin-database`（Cordis 标准 ORM）。表名 `athena.messages`，主键 `[lifeId, bodySid, messageId]`，索引 `[lifeId, bodySid, channelId, timestamp, messageId]` 与 `[lifeId, bodySid, userId, timestamp, messageId]`。实现在 `plugins/cortex-chat/src/message-store.ts`——它是 Cortex 的内部模块，不是独立插件（`plugins/message-store` 仍是占位，见 `docs/06-progress-and-roadmap.md`）

4. ~~WsMessage 的 id 生成策略~~ — **已作废**：2026-08-28 重设计后工作区是内存 `ModelMessage[]`，没有 workspace-store、没有 `WsMessage` 信封、没有元数据 id

5. **大型 tool result 的处理** — ✅ **已定**：剪枝阶段（`prune.ts`）对成功的大块 tool output 保留首尾（默认 1000/400/400 字符，可配置 `toolOutputMaxChars` / `toolOutputHeadChars` / `toolOutputTailChars`）、裁去中间并插入省略标记；失败的工具名、错误信息与目标标识原样保留

6. **Checkpoint 历史保留策略** — ✅ **已定（初始策略）**：只保留最近一个（`checkpoint.json`）。当前阶段无需历史回溯；未来如需多版本保留可扩展为 `checkpoint-{id}.json` + 索引文件

7. ~~scene session 的清理~~ — **已作废**：scene session store 已删除；跨场景连续性由全局压缩条目承担，无 per-scene 状态需要清理

---

## 参考来源

- ~~Satori v5（`vendor/satorijs/`）~~ —— 已移除；Bot/Adapter/Session 抽象的历史参考见 `references/`
- YesImBot agent-runtime（`/home/workspace/YesImBot/packages/agent-runtime/src/message.ts`）—— WsMessage 设计的直接参考
- AI SDK v7（`@ai-sdk/provider-utils`）—— ModelMessage 类型定义
- [01-context-construction.md](./01-context-construction.md) —— 三块模型
- [02-multi-scene-attention.md](./02-multi-scene-attention.md) —— 检查点语义、workspace 生命周期
