# 附录 B · Satori v5 for Athena 速查

> 只讲 Athena 中实际用到的部分，并明确标出**我们改过什么**。所有断言对照 `vendor/satorijs/` 的实际 vendored 源码核验。
>
> 上游对照：`references/satori`（v5 main）、`references/satori-v4`（v4 stable）

---

## 1. Satori 是什么

一个**统一的 IM 协议与实现**：

- **协议层**（`@satorijs/protocol`）—— 平台无关的 IM 数据模型与 40+ 操作定义
- **内容模型**（`@satorijs/element`）—— XML 风格的富文本（`h()` 函数）
- **运行时**（`@satorijs/core`）—— `Satori` service、`Bot` 基类、`Adapter` 基类、`Session`
- **适配器生态** —— 20+ 平台（QQ、Discord、Telegram、Slack、Lark、Kook…）

在 Athena 中它是**库**，不是组织中心。Satori 被 `capability-message` 包在内部，Cortex 只看到 `ctx.message`。

---

## 2. 在 Athena 中的位置

```
Life Group Context（isolate: { message: true, satori: true }）
│
├── ctx.message = MessageService          ← Cortex 唯一的 IM 入口
│     └── ctx.plugin(Satori)              ← 在自己的 context 上安装
│
├── ctx.satori = Satori                   ← group 内可见（adapter 需要）
│     └── bots: Bot[] & Dict<Bot>
│
├── Adapter 插件（inject: ["satori"]）      ← Nerve
│     └── new Bot(ctx, config) → 自动 push 进 ctx.satori.bots
│
└── ctx.cortex = CortexChat（inject: ["life", "message"]）
      └── ❌ 不访问 ctx.satori
```

**可见性规则**：

- `ctx.satori` 在 Life group 内可见（sibling adapter 必需），跨 group 隔离
- `ctx.bots` **不存在**（见 §6）
- Cortex 通过 `ctx.message.bots` 访问 bot 列表

---

## 3. 核心类型

### 3.1 `Satori` service

```typescript
// vendor/satorijs/core/src/index.ts:123
export class Satori extends Service {
  constructor(ctx: Context) {
    super(ctx, "satori");
    // ...
  }

  /** bot 注册表：数组 + 按 sid 索引的 Proxy */
  public bots: Bot[] & Dict<Bot>;

  component(name, component, options?): () => void;
  defineInternalRoute<P>(path: P, callback): ...;
  handleInternalRoute(req: Request): Promise<Response>;
  toJSON(meta?): Meta;
}
```

`bots` 是一个 Proxy 包装的数组（`index.ts:183-199`），既能当数组用又能按 `sid` 索引：

```typescript
ctx.satori.bots.length; // 数组语义
ctx.satori.bots[0]; // 数字索引
ctx.satori.bots["onebot:123456"]; // sid 索引 ← Proxy 提供
delete ctx.satori.bots["onebot:123456"]; // 按 sid 删除
```

### 3.2 `Bot`

```typescript
// vendor/satorijs/core/src/bot.ts:25
export abstract class Bot<T = any> {
  static reusable = true;                     // ← 可多实例
  static MessageEncoder?: ...;

  public [Service.tracker] = { associate: "bot", property: "ctx" };

  public sn: number;                          // login 序号
  public user?: User;
  public platform?: string;
  public features: string[];                  // ← 能力发现
  public hidden = false;
  public error: any;
  public internal: any;                       // ← 平台原生 API

  constructor(public ctx: Context, public config: T, public adapterName: string) {
    this.sn = ++ctx.satori._loginSeq;
    this._internalRouter = new InternalRouter(ctx);
    this.context = ctx;
    ctx.satori.bots.push(this);                // ← 自动注册（我们改过，原为 ctx.bots）
    this.platform = adapterName;
    this.features = Object.entries(Methods)
      .filter(([, value]) => this[value.name])
      .map(([key]) => key);                    // ← 按实现了哪些方法推导 features
    // ...
  }

  async *[Service.init]() {
    yield () => this.dispose();
    this.dispatchLoginEvent("login-added");
    await this.start();
  }
}
```

关键成员：

| 成员                                 | 说明                                                                       |
| ------------------------------------ | -------------------------------------------------------------------------- |
| `bot.sid`                            | `` `${platform}:${selfId}` `` —— **Athena 中的 bot 寻址标识**              |
| `bot.selfId` / `bot.userId`          | accessor → `user.id`（`bot.ts:278-279`）                                   |
| `bot.isActive`                       | `status !== OFFLINE && status !== DISCONNECT`                              |
| `bot.status`                         | `Status` 枚举；setter 会 dispatch `login-updated`                          |
| `bot.features`                       | 该 bot 实际支持的操作名数组 —— **能力协商用这个，不要编译期耦合**          |
| `bot.internal`                       | 平台原生 API（如 `bot.internal.setEssenceMsg(...)`）—— Layer 3 tool 的来源 |
| `bot.online()` / `bot.offline(err?)` | 状态切换                                                                   |
| `bot.session(event?)`                | 创建 Session                                                               |
| `bot.dispatch(session)`              | **把事件注入 Cordis 事件系统**                                             |

### 3.3 `Bot` 的生命周期

```typescript
async *[Service.init]() {
  yield () => this.dispose();       // ← fiber dispose 时从 bots 移除 + stop()
  this.dispatchLoginEvent("login-added");
  await this.start();               // → parallel('bot-connect') → this.connect()
}
```

子类只需实现 `connect()` / `disconnect()`：

```typescript
class MyBot extends Bot<MyConfig> {
  static reusable = true;
  static inject = ["satori"];

  constructor(ctx: Context, config: MyConfig) {
    super(ctx, config, "my-platform");
    this.selfId = config.selfId;
  }

  async connect() {
    // 建立连接…
    this.online(); // ← 必须调，否则 isActive 为 false
  }

  async disconnect() {
    // 关闭连接…
  }
}
```

> ⚠️ 不要覆写 `start()` / `stop()` —— 它们负责 `bot-connect` / `bot-disconnect` 事件与错误捕获。

### 3.4 `Session`

```typescript
// vendor/satorijs/core/src/session.ts:30
export class Session {
  public [Service.tracker] = { associate: "session", property: "ctx" };

  public sn: number;
  public bot!: Bot;
  public app!: Context; // = bot.ctx.root
  public event: Event;
  public locales: string[];
}
```

Session 本质是 `Event` 的**访问器包装**。所有常用字段都是 accessor（`session.ts:169-183`）：

| Accessor              | 映射到                |
| --------------------- | --------------------- |
| `session.type`        | `event.type`          |
| `session.subtype`     | `event.subtype`       |
| `session.selfId`      | `event.selfId`        |
| `session.platform`    | `event.platform`      |
| `session.timestamp`   | `event.timestamp`     |
| `session.userId`      | `event.user.id`       |
| `session.channelId`   | `event.channel.id`    |
| `session.channelName` | `event.channel.name`  |
| `session.guildId`     | `event.guild.id`      |
| `session.guildName`   | `event.guild.name`    |
| `session.messageId`   | `event.message.id`    |
| `session.operatorId`  | `event.operator.id`   |
| `session.roleId`      | `event.role.id`       |
| `session.quote`       | `event.message.quote` |
| `session.referrer`    | `event.referrer`      |

计算属性（getter）：

| Getter             | 值                                                               |
| ------------------ | ---------------------------------------------------------------- |
| `session.isDirect` | `event.channel.type === Channel.Type.DIRECT`                     |
| `session.author`   | `{ ...event.user, ...event.member, userId, username, nickname }` |
| `session.uid`      | `` `${platform}:${userId}` ``                                    |
| `session.gid`      | `` `${platform}:${guildId}` ``                                   |
| `session.cid`      | `` `${platform}:${channelId}` ``                                 |
| `session.fid`      | `` `${platform}:${channelId}:${userId}` ``                       |
| `session.sid`      | `` `${platform}:${selfId}` ``                                    |
| `session.elements` | `event.message.elements`（`h.Element[]`）                        |
| `session.content`  | `elements.join("")`；setter 会 `h.parse()` 并抽出前导 quote      |

> ⚠️ **`session.stripped` 与 `session.stripped.appel` 在 Athena 中不存在。** 那是 `@koishijs/core` 的加料。检测"被 @"要自己看 elements：
>
> ```typescript
> const mentioned = (session.elements ?? []).some((el) => el.type === "at" && el.attrs.id === session.selfId);
> ```

### 3.5 `Methods`（`@satorijs/protocol`）

平台无关的操作集，`Bot` 通过 `interface Bot extends Methods` 获得类型。分类：

| 分类          | 代表方法                                                                            |
| ------------- | ----------------------------------------------------------------------------------- |
| Message       | `createMessage` / `getMessage` / `getMessageList` / `editMessage` / `deleteMessage` |
| Channel       | `getChannel` / `getChannelList` / `createDirectChannel` / `updateChannel`           |
| Guild         | `getGuild` / `getGuildList` / `handleGuildRequest`                                  |
| Guild Member  | `getGuildMember` / `getGuildMemberList` / `kickGuildMember` / `muteGuildMember`     |
| Guild Role    | `getGuildRoleList` / `createGuildRole` / `setGuildMemberRole`                       |
| Reaction      | `createReaction` / `deleteReaction` / `getReactionList`                             |
| User / Friend | `getUser` / `getFriendList` / `handleFriendRequest`                                 |
| Upload        | `createUpload`                                                                      |

`Bot` 基类实现了三个便捷方法（`bot.ts:191-204`）：

```typescript
createMessage(channelId, content, referrer?, options?): Promise<Message[]>
sendMessage(channelId, content, referrer?, options?): Promise<string[]>   // 返回 id 数组
sendPrivateMessage(userId, content, guildId?, options?): Promise<string[]>
```

以及分页迭代器（`bot.ts:253-276`）—— 对 `getMessage` / `getReaction` / `getFriend` / `getGuild` / `getGuildMember` / `getGuildRole` / `getChannel` 自动生成 `xxxIter()`：

```typescript
for await (const message of bot.getMessageIter(channelId)) {
  // 自动翻页
}
```

### 3.6 能力发现：`bot.features`

```typescript
this.features = Object.entries(Methods)
  .filter(([, value]) => this[value.name])
  .map(([key]) => key);
```

按"实际实现了哪些方法"运行时推导。**这是 Athena 做能力协商的正确方式** —— 不要在编译期假设某平台支持某操作：

```typescript
if (bot.features.includes("reaction.create")) {
  await bot.createReaction(channelId, messageId, emoji);
}
// 或
if (await bot.supports("reaction.create")) { ... }
```

### 3.7 `Element`（`@satorijs/element`）

XML 风格的内容模型，用 `h()` 构造：

```typescript
import { h } from "@satorijs/element";

h("at", { id: "123456" });
h("img", { src: "https://..." });
h("quote", { id: messageId });
h("audio", { src: "..." });
h("br");

// Fragment = string | Element | (string | Element)[]
await ctx.message.createMessage(channelId, [h("quote", { id: session.messageId }), h("at", { id: session.userId }), " 你好"]);
```

`h.parse(str)` 把 XML 字符串解析为 `Element[]`；`elements.join("")` 反向序列化（`session.content` 的实现）。

### 3.8 `Adapter` / `WsClient`

```typescript
// vendor/satorijs/core/src/adapter.ts
export abstract class WsClientBase<B extends Bot = Bot> {
  protected abstract prepare(): Awaitable<WebSocket>;
  protected abstract accept(socket: WebSocket): void;
  protected abstract getActive(): boolean;
  protected abstract setStatus(status: Status, error?: Error): void;

  async start() { /* 带重试的连接循环 */ }
  async stop() { this.socket?.close(); }
}

export abstract class WsClient<B extends Bot<WsClientConfig>> extends WsClientBase<B> { ... }
```

`WsClientConfig` 提供标准重连配置（`retryTimes` / `retryInterval` / `retryLazy`）。写 WebSocket 类 adapter 时继承 `WsClient` 即可获得重连逻辑。

---

## 4. 事件

### 4.1 `bot.dispatch()` —— 事件注入点

```typescript
// vendor/satorijs/core/src/bot.ts:172-189
dispatch(session: Session) {
  let events = [session.type];
  for (const aliases of eventAliases) {
    if (aliases.includes(session.type)) {
      events = aliases;
      session.type = aliases[0];
      break;
    }
  }
  this.context.emit("internal/session", session);         // ← ① 全局广播
  if (session.type === "internal") {
    this.context.emit(session.event._type, session.event._data, session.bot);
    return;
  }
  for (const event of events) {
    this.context.emit(session, event as any, session);    // ← ② session 作为 thisArg
  }
}
```

两步很关键：

1. **`internal/session` 是全局广播** —— 进程内**每个** MessageService 都会看到。这是 `capability-message` 在此注入 `[Context.filter]` 的时机。
2. **业务事件以 `session` 作为 `thisArg` 发射** —— cordis 因此会读取 `session[Context.filter]`，实现作用域过滤。

事件别名（`bot.ts:13-17`）：

```typescript
[
  "message-created",
  "message",
] // 两个名字都发
[("guild-removed", "guild-deleted")][("guild-member-removed", "guild-member-deleted")];
```

所以 `ctx.on("message", ...)` 与 `ctx.on("message-created", ...)` 等价。

### 4.2 完整事件清单

```typescript
// vendor/satorijs/core/src/index.ts:36-68
interface Events {
  "satori/meta"(): void;
  "internal/session"(session: Session): void;
  "interaction/command"(session: Session): void;
  "interaction/button"(session: Session): void;
  message(session: Session): void;
  "message-created"(session: Session): void;
  "message-deleted"(session: Session): void;
  "message-updated"(session: Session): void;
  "message-pinned"(session: Session): void;
  "message-unpinned"(session: Session): void;
  "guild-added"(session: Session): void;
  "guild-removed"(session: Session): void;
  "guild-updated"(session: Session): void;
  "guild-member-added"(session: Session): void;
  "guild-member-removed"(session: Session): void;
  "guild-member-updated"(session: Session): void;
  "guild-role-created"(session: Session): void;
  "guild-role-deleted"(session: Session): void;
  "guild-role-updated"(session: Session): void;
  "reaction-added"(session: Session): void;
  "reaction-removed"(session: Session): void;
  "login-added"(session: Session): void;
  "login-removed"(session: Session): void;
  "login-updated"(session: Session): void;
  "friend-request"(session: Session): void;
  "guild-request"(session: Session): void;
  "guild-member-request"(session: Session): void;
  "before-send"(session: Session, options: SendOptions): Awaitable<void | boolean>;
  send(session: Session): void;
  "bot-connect"(client: Bot): Awaitable<void>;
  "bot-disconnect"(client: Bot): Awaitable<void>;
}
```

Cortex 可直接订阅任意一个 —— 事件作用域由 `capability-message` 保证。

### 4.3 `Session` 默认无 `[Context.filter]`

Session 只声明了 tracker：

```typescript
public[Service.tracker] = { associate: "session", property: "ctx" };
```

**没有 `[Context.filter]`** → 默认广播给所有 listener。多 Life 隔离必须由 `capability-message` 注入 filter。详见 [../02-architecture.md](../02-architecture.md) §5.1。

### 4.4 Tracker 陷阱

`Bot` 与 `Session` 都声明 `[Service.tracker] = { property: "ctx" }`。cordis 因此会把它们包成 traced proxy，使 `.ctx` 指向**接收方** context，而非拥有者。

**判断归属时必须先 unwrap**：

```typescript
const ORIGINAL = Symbol.for("cordis.original");

function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}

const bot = unwrap(session.bot);
if (!bot || bot.ctx[Context.isolate]["satori"] !== mySatoriSymbol) return;
```

详见 [../05-lessons-learned.md](../05-lessons-learned.md) §3.5。

---

## 5. Satori v4 → v5 差异

| 方面           | v4（stable，已发布）                                                        | v5（alpha，我们用的）               |
| -------------- | --------------------------------------------------------------------------- | ----------------------------------- |
| Cordis 依赖    | `^3.18.1`                                                                   | `^4.0.0-rc.3`                       |
| npm 发布       | ✅ `@satorijs/core@4.6.0`                                                   | ❌ 未发布 → **必须 vendor**         |
| Service 注册   | `static [Service.provide] = 'satori'` + `static [Service.immediate] = true` | `super(ctx, "satori")`              |
| Bot 生命周期   | `static reusable = true` + 手动 `start()` / `stop()`                        | `async *[Service.init]()` generator |
| Context 泛型   | `Satori<C extends Context>`                                                 | `Satori`（无泛型）                  |
| InternalRouter | 自定义 HTTP 方法式                                                          | 标准 `Request` / `Response`         |
| HTTP 集成      | `ctx.on("http/file", ...)`                                                  | `ctx.on("http/fetch", ...)`         |
| Adapter 抽象   | 相同模式                                                                    | 相同模式                            |
| `bot.dispatch` | 相同事件发射模式                                                            | 相同事件发射模式                    |

### 为什么必须用 v5

Satori v4 依赖 cordis v3，与 Athena 的 cordis v4 root **context tree 不兼容** —— 两个大版本的 `Context` 是不同的类，Symbol 也不同。这不是可绕过的兼容问题。

### 为什么必须 vendor

v5 未发布到 npm（无 `next` tag、无 alpha release）。没有可依赖的版本号。

---

## 6. 我们改过什么

### 6.1 移除 `ctx.mixin`

**上游 v5**（`references/satori/packages/core/src/index.ts`）在 `Satori` 构造函数中调：

```typescript
ctx.mixin("satori", ["bots", "component"]);
```

**Athena 已删除这一行。**

**原因**：`mixin` → `accessor` → 注册进 root `ReflectService.props`（**字符串键的单例字典**）。`isolate` 只隔离 `store`（Symbol 键），对 `props` 零效果。因此两个 Satori fiber 共存时第二个必然抛：

```
property "bots" is already declared as accessor
```

完整根因链见 [../05-lessons-learned.md](../05-lessons-learned.md) §1。

### 6.2 `ctx.bots` → `ctx.satori.bots`

| 文件                                          | 位置                   | 改动                                                   |
| --------------------------------------------- | ---------------------- | ------------------------------------------------------ |
| `vendor/satorijs/core/src/bot.ts`             | `:57` 构造函数         | `ctx.bots.push(this)` → `ctx.satori.bots.push(this)`   |
| `vendor/satorijs/core/src/bot.ts`             | `:95, :97` `dispose()` | `ctx.bots.findIndex/splice` → `ctx.satori.bots.*`      |
| `vendor/satorijs/core/src/bot.ts`             | `:117` `status` setter | `ctx.bots?.some(...)` → `ctx.satori?.bots?.some(...)`  |
| `vendor/satorijs/adapter-qq/src/bot/index.ts` | `:78` `stop()`         | `delete ctx.bots[sid]` → `delete ctx.satori.bots[sid]` |
| `plugins/sandbox/src/index.ts`                | `ensureBot`            | `ctx.bots` → `ctx.satori.bots`                         |

### 6.3 结论：`ctx.bots` 与 `ctx.component` 在 Athena 中不存在

```typescript
// ❌ 一律不可用
ctx.bots;
ctx.component("name", render);

// ✅ 正确写法
ctx.satori.bots; // 在 satori domain 内（adapter / nerve）
ctx.message.bots; // Cortex 侧
ctx.satori.component("name", render);
```

> ⚠️ **已知类型级不一致**：`vendor/satorijs/core/src/index.ts:28-29` 的 `declare module "cordis"` **仍然**声明了 `bots` 与 `component`：
>
> ```typescript
> export interface Context {
>   [Context.session]: Session;
>   satori: Satori;
>   bots: Bot[] & Dict<Bot>; // ← 类型存在，运行时不存在
>   component(name, component, options?): () => void; // ← 同上
> }
> ```
>
> 即 TypeScript 不会阻止你写 `ctx.bots`，但运行时会抛 `cannot get property "bots" without inject`。**清理这两行声明是一个待办项**。

### 6.4 改名的 vendored 包

| 原名                       | Athena 中                   |
| -------------------------- | --------------------------- |
| `@satorijs/adapter-onebot` | `@athena-ai/adapter-onebot` |

其余 vendored 包保留 `@satorijs/*` 名字。

### 6.5 vendored 包清单

| 包                          | 版本          | 状态                      |
| --------------------------- | ------------- | ------------------------- |
| `@satorijs/core`            | 5.0.0-alpha.0 | ✅ 已打补丁（mixin）      |
| `@satorijs/protocol`        | 2.0.0-alpha.0 | ✅ 原样                   |
| `@satorijs/element`         | 4.0.0-alpha.0 | ✅ 原样                   |
| `@satorijs/adapter-satori`  | 2.0.0-alpha.0 | ✅ 原样                   |
| `@athena-ai/adapter-onebot` | —             | ✅ 已改名                 |
| `@satorijs/adapter-qq`      | —             | ✅ 已打补丁（`ctx.bots`） |

从 npm 直接依赖（无需 vendor）：`cordis`、`@cordisjs/element`、`@cordisjs/plugin-http`、`cosmokit`。

### 6.6 修改 vendored 代码的规矩

1. 改动尽可能小、局部
2. **登记**到 [../02-architecture.md](../02-architecture.md) §11.3 的补丁表
3. 在 [../05-lessons-learned.md](../05-lessons-learned.md) 记录根因（若是为了绕过某个坑）
4. `vendor/` 被 oxfmt 忽略 —— **不要**顺手格式化整个文件，否则未来同步上游会产生巨大 diff
5. 单独成一个提交，标题写明是 vendor 改动

---

## 7. Adapter 开发速查

### 7.1 在 Athena 中安装 adapter

Adapter 是 Life group 内的 sibling entry，`inject: ["satori"]`：

```yaml
- name: "@cordisjs/plugin-group"
  label: Alice
  isolate: { life: true, cortex: true, message: true, satori: true }
  config:
    - name: "@athena-ai/plugin-life"
      config: { persona: { name: Alice, description: "...", traits: {} } }
    - name: "@athena-ai/capability-message" # ← 提供 satori domain
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/adapter-onebot" # ← adapter
      config:
        selfId: "123456"
        endpoint: "ws://localhost:6700"
        protocol: ws
```

**顺序无关** —— cordis 的 inject 机制会在 `satori` 可用后自动激活 adapter。

### 7.2 写一个最小 Bot

```typescript
import { Bot, Universal } from "@satorijs/core";
import type { Context } from "cordis";
import { Schema } from "@athena-ai/core";

export interface Config {
  selfId: string;
  endpoint: string;
}

export const Config: Schema<Config> = Schema.object({
  selfId: Schema.string().required(),
  endpoint: Schema.string().required(),
});

export default class MyBot extends Bot<Config> {
  static reusable = true;
  static inject = ["satori"];
  static Config = Config;

  constructor(ctx: Context, config: Config) {
    super(ctx, config, "my-platform");
    this.selfId = config.selfId;
    this.user = { id: config.selfId, name: config.selfId };
  }

  async connect() {
    // 建立连接、订阅平台事件…
    this.online();
  }

  async disconnect() {
    // 断开
  }

  /** 实现 Methods 中的方法 —— features 会自动包含它 */
  async createMessage(channelId: string, content: Fragment) {
    // 发送到平台，返回 Message[]
    return [];
  }
}
```

### 7.3 把平台事件变成 Session

```typescript
private onPlatformMessage(raw: PlatformMessage) {
  const session = this.session({
    user: { id: raw.senderId, name: raw.senderName },
    channel: {
      id: raw.channelId,
      type: raw.isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
    },
    guild: raw.isDirect ? undefined : { id: raw.guildId },
    timestamp: raw.timestamp,
  });
  session.type = "message";
  session.content = raw.text;        // setter 会 h.parse()
  session.messageId = raw.messageId;
  this.dispatch(session);            // ← 注入 Cordis 事件系统
}
```

### 7.4 WebSocket adapter 复用重连逻辑

```typescript
import { WsClient, WsClientConfig } from "@satorijs/core";

class MyWsClient extends WsClient<MyBot> {
  protected async prepare() {
    return this.bot.ctx.http.ws(this.bot.config.endpoint);
  }

  protected accept(socket: WebSocket) {
    socket.addEventListener("message", (ev) => this.onMessage(ev));
    this.bot.online();
  }

  protected getActive() {
    return this.bot.isActive;
  }

  protected setStatus(status: Status, error?: Error) {
    this.bot.status = status;
    this.bot.error = error;
  }
}
```

### 7.5 Nerve 也可以不是 Satori adapter

`sandbox-nerve` 展示了另一条路径：自己创建一个继承 `Bot` 的类（`SandboxBot`）注册进本地 `ctx.satori`，输入来自 WebUI 而非平台。参考 [../04-patterns-and-recipes.md](../04-patterns-and-recipes.md) §4.1。

---

## 8. IM 连通策略

### 8.1 路线 A：桥接现有 Koishi（推荐先行）

```
Koishi 实例（Cordis v3 + Satori v4）
  ├── adapter-onebot（连 Napcat / LLOneBot）
  ├── adapter-discord / -telegram / ...
  └── @koishijs/plugin-server（暴露 Satori Protocol API）
         │
         │  HTTP + WebSocket（Satori Protocol）
         ▼
Athena Runtime（Cordis v4 + Satori v5 vendored）
  └── @satorijs/adapter-satori
         → Bot 出现在 ctx.satori.bots
         → 事件经 Cordis 事件系统推送
         → Cortex 正常消费
```

**收益**：现有 Koishi 部署零改动；立刻获得 Koishi 支持的全部平台；Satori Protocol 是定义良好的 wire protocol，部署上完全隔离。

### 8.2 路线 B：直接用 vendored adapter

`@athena-ai/adapter-onebot` 与 `@satorijs/adapter-qq` 已 vendored，可直连平台，消除 Koishi 依赖。

### 8.3 Fallback（评估认为无必要）

若 Satori v5 证明不可用：

1. 只依赖 `@satorijs/protocol`（类型）
2. 只依赖 `@satorijs/element`（内容模型）
3. 自行实现 core：Bot 基类 + Adapter 生命周期 + Session + dispatch，约 400 行实际逻辑
4. Fork `adapter-satori`，约 200 行

---

## 9. 陷阱速查

| 陷阱                                    | 正确做法                                                    |
| --------------------------------------- | ----------------------------------------------------------- |
| 用 `ctx.bots`                           | 用 `ctx.satori.bots` / `ctx.message.bots`                   |
| 用 `ctx.component(...)`                 | 用 `ctx.satori.component(...)`                              |
| 用 `session.stripped.appel`             | 自己检查 `session.elements` 里的 `at` 元素                  |
| 直接读 `session.bot.ctx` 判归属         | 先 `unwrap()`（`Symbol.for("cordis.original")`）            |
| 假设某平台支持某操作                    | 查 `bot.features` 或 `await bot.supports(name)`             |
| 覆写 `Bot.start()` / `stop()`           | 实现 `connect()` / `disconnect()`                           |
| 忘记在 `connect()` 里调 `this.online()` | 必须调，否则 `isActive` 为 `false`，`_resolveBot` 找不到它  |
| 在 Cortex 里 `inject: ["satori"]`       | Cortex 只能 `inject: ["message"]`                           |
| 顺手格式化 vendored 文件                | `vendor/` 被 oxfmt 忽略，保持上游格式                       |
| 改 vendored 代码不登记                  | 登记到 [../02-architecture.md](../02-architecture.md) §11.3 |

---

## 10. 源码地图

`vendor/satorijs/core/src/`：

| 文件          | 内容                                                  | 关键行                                                             |
| ------------- | ----------------------------------------------------- | ------------------------------------------------------------------ |
| `index.ts`    | `Satori` service、`declare module "cordis"`、事件清单 | 24-68（声明）、123-235（Satori）、183-199（bots Proxy）            |
| `bot.ts`      | `Bot` 抽象类、生命周期、`dispatch`、便捷发送方法      | 25-68（构造）、70-74（init）、172-189（dispatch）、191-204（send） |
| `session.ts`  | `Session` 类、accessor 定义                           | 30-150（类体）、169-183（accessor）                                |
| `adapter.ts`  | `WsClientBase` / `WsClient` / `WsClientConfig`        | 15-25（Config）、27-106（Base）                                    |
| `message.ts`  | `MessageEncoder` 基类                                 | —                                                                  |
| `internal.ts` | `InternalRouter`、`JsonForm`                          | —                                                                  |

对照参考：

- `references/satori/` —— v5 上游（对比我们的补丁）
- `references/satori-v4/` —— v4 stable（对比 API 演进）
