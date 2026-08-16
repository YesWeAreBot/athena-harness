# OneBot Body

## 它解决什么问题

OneBot 是一个聊天平台协议。一个真正的 OneBot 接入点会持续收到私聊、群聊、通知、好友请求等事件，也需要发送消息、撤回消息、点赞等动作。如果让 Life 或 Mode 直接理解这些平台细节，Life 就会变成 OneBot 专用逻辑，以后接 Satori、Discord、Minecraft 等 Body 时又得重写一遍。

OneBot Body 把 OneBot 平台放在 BodyAdapter 边界后面：

- OneBot 事件被转换成 Athena 的 Percept。
- Life 的动作被转换成 OneBot HTTP API 调用。
- 连接、断线、重连、超时、鉴权这些平台可靠性问题留在 Body 内部。
- Body 的实时状态通过 `body/state-changed` 暴露，供上层和可观测系统使用。

它不是一个聊天机器人，也不是一个 Mode。它只负责“手和眼”：让 Life 能收到 OneBot 世界发生的事，并能对 OneBot 世界执行动作。

## 什么时候用

当你的 OneBot 实现提供了正向 WebSocket 事件源和 HTTP 动作端点时，就可以使用这个包。常见实现包括 NapCat、Lagrange、go-cqhttp 等，它们都遵循 OneBot v11 的 `message`、`notice`、`request`、`meta_event` 事件结构。

如果你的 OneBot 实现只支持反向 WebSocket，或者 HTTP 路径不是标准路径，当前包还不能直接覆盖；你需要把该实现做成另一个 BodyAdapter，而不是往这个包里面塞私有协议。

## 快速开始

使用前先理解依赖：

- `bodyRegistry` 是必须的，它负责注册 Body、派发 Percept、执行 Actuator。
- 如果要把 Percept 路由给 Life 和 Mode，还需要 `SessionRegistry`、`lifeRegistry`、`modeRegistry`。
- `onebotBody` 插件只负责把 OneBot Body 注册进 `ctx.bodies`，不负责 Life 或 Mode。

```ts
import { SessionRegistry } from "@athena/session";
import { Context } from "cordis";
import { bodyRegistry, lifeRegistry, modeRegistry } from "@yesimbot/athena-runtime";
import { onebotBody } from "@yesimbot/onebot-body";

const ctx = new Context();

await Promise.all([
  ctx.plugin(SessionRegistry),
  ctx.plugin(bodyRegistry),
  ctx.plugin(lifeRegistry),
  ctx.plugin(modeRegistry),
  ctx.plugin(
    onebotBody({
      id: "onebot",
      name: "我的 QQ",
      wsUrl: "ws://127.0.0.1:6700",
      httpUrl: "http://127.0.0.1:3000",
      accessToken: "你的 access token，没有就省略",
      selfId: "123456",
    }),
  ),
]);

const life = ctx.lives.create({ id: "main" });
await life.attachBody("onebot");
```

注册一个最简单的 Mode，让它把收到的私聊或群聊消息原样回复：

```ts
ctx.modes.register({
  name: "echo",
  setup: async (modeCtx) => ({
    handle: async (event) => {
      if (event.kind !== "message-created") return false;

      const userId = event.data.user_id;
      const groupId = event.data.group_id;
      if (userId === undefined && groupId === undefined) return false;

      const result = await modeCtx.bodies?.act("onebot", "send", {
        ...(userId === undefined ? {} : { userId }),
        ...(groupId === undefined ? {} : { groupId }),
        message: [{ type: "text", data: { text: "收到" } }],
      });

      return result?.status === "ok";
    },
  }),
});

await life.createMode("echo", {});
```

这里的 `event.data.user_id`、`event.data.group_id` 来自 OneBot 原始事件。更推荐的做法是 Mode 只读 Percept 里的规范化字段，把权限、会话、记忆等策略放在 Mode 内部。

## 配置

`onebotBody(config)` 接收一个 `OneBotConfig`。

| 字段                    | 默认值     | 说明                                                                   |
| ----------------------- | ---------- | ---------------------------------------------------------------------- |
| `id`                    | `"onebot"` | Body 的唯一 id。Life 通过它 `attachBody`，动作通过它执行。             |
| `name`                  | `"OneBot"` | 可读名称，出现在 Body 上。                                             |
| `wsUrl`                 | 必填       | 正向 WebSocket 事件源地址。                                            |
| `httpUrl`               | 必填       | OneBot HTTP 动作端点地址。                                             |
| `accessToken`           | 无         | 同时用于 WS 的 `access_token` 参数和 HTTP 的 `Authorization: Bearer`。 |
| `selfId`                | 无         | 机器人自身账号，写入 Body state，不作为安全边界。                      |
| `request.timeoutMs`     | `10_000`   | 单次 HTTP 请求或 WS 建连超时。                                         |
| `request.retries`       | `2`        | HTTP 层对可重试错误的最大额外重试次数。                                |
| `reconnect.enabled`     | `true`     | 已连接后断线是否自动重连。                                             |
| `reconnect.maxAttempts` | `10`       | 每次断线后的最大重连尝试次数。                                         |
| `reconnect.baseDelayMs` | `1_000`    | 指数退避起始延迟。                                                     |
| `reconnect.maxDelayMs`  | `30_000`   | 指数退避最大延迟。                                                     |

HTTP 重试不是“失败就无限重试”。只有网络错误、超时、`408`、`429`、`5xx` 会重试；`4xx` 和 OneBot 返回的失败 `retcode` 不会重试，避免把参数错误放大成三倍请求。

## 事件感知

OneBot WebSocket 每来一个 JSON 事件，Body 会先解析、归一化，再派发 Percept。

事件映射如下：

| OneBot `post_type` | Percept `kind`                       |
| ------------------ | ------------------------------------ |
| `message`          | `message-created`                    |
| `message_sent`     | `message-sent`                       |
| `notice`           | `notice.{notice_type}`               |
| `request`          | `request.{request_type}`             |
| `meta_event`       | 不派发 Percept，只刷新 `lastEventAt` |

`meta_event` 是连接层心跳和生命周期信号，不应该被当作业务事件进入 Mode，所以它不会走 Percept 管线。

一个私聊消息大约会变成这样：

```json
{
  "id": "percept_xxx",
  "bodyId": "onebot",
  "kind": "message-created",
  "source": "onebot",
  "data": {
    "message_id": 1,
    "user_id": 100,
    "raw_message": "hello",
    "message": [{ "type": "text", "data": { "text": "hello" } }],
    "segments": [{ "type": "text", "data": { "text": "hello" } }],
    "channelKey": "onebot:123456:private:100"
  },
  "actor": {
    "id": "100",
    "name": "Alice"
  },
  "target": {
    "id": "onebot:123456:private:100",
    "kind": "private"
  }
}
```

Percept 的 `data` 保留原始事件，因此 Mode 需要 `raw_message`、`sender`、`flag`、`comment` 等字段时仍然拿得到。`segments` 是归一化后的消息段，推荐作为主要读取入口。

Channel 身份不是单一字符串，而是 `selfId + 会话类型 + 会话 id` 的组合：

```text
onebot:{selfId}:private:{userId}
onebot:{selfId}:group:{groupId}
onebot:{selfId}:channel:{channelId}
```

## 动作

Body 暴露以下 Actuator：

| Actuator       | 输入                             | 说明                                      |
| -------------- | -------------------------------- | ----------------------------------------- |
| `send`         | `{ userId?, groupId?, message }` | 根据是否传 `groupId` 自动选择私聊或群聊。 |
| `send_private` | `{ userId, message }`            | 明确私聊。                                |
| `send_group`   | `{ groupId, message }`           | 明确群聊。                                |
| `recall`       | `{ messageId }`                  | 撤回消息。                                |
| `send_like`    | `{ userId, times? }`             | 点赞，`times` 默认 1，必须是正整数。      |

`message` 可以是 OneBot 消息段数组，也可以是纯文本字符串。

执行示例：

```ts
const result = await ctx.bodies.act(
  "onebot",
  "send_group",
  {
    groupId: 200,
    message: [{ type: "text", data: { text: "大家好" } }],
  },
  {
    retries: 1,
  },
);

if (result.status === "ok") {
  console.log(result.output); // 通常是 { message_id: 123 }
}
```

动作支持取消。传入 `AbortSignal` 后，如果调用方已经中止，Body 会返回 `status: "canceled"`，不会继续请求 OneBot：

```ts
const controller = new AbortController();
const result = await ctx.bodies.act("onebot", "send", action, {
  signal: controller.signal,
});
```

失败结果会保留 `error` 和 `retryable`。`retryable: false` 表示参数、权限或 OneBot 明确拒绝，上层不应盲目重试。

## 生命周期与可靠性

Body 生命周期由 `BodyRegistry.registerAdapter` 管理：

- 初始 WebSocket 建连失败时，`registerAdapter` 会抛错，Body 注册被回滚，不会留下半启动状态。
- 已经连接后断线，Transport 会按指数退避自动重连。
- 停止 Body 时，Transport 先断开，Body 再从 Registry 注销；即使 `stop()` 抛错，注销仍会完成。

Body state 至少包含：

```json
{
  "connection": "connected",
  "selfId": "123456",
  "lastEventAt": 1755300000000
}
```

每次 `patchState` 都会发出 `body/state-changed`，可以直接订阅：

```ts
ctx.on("body/state-changed", (event) => {
  if (event.id === "onebot") {
    console.log(event.state.connection);
  }
});
```

当前可观测入口：

- `body/percept`：平台事件是否进入 Percept 管线。
- `body/state-changed`：连接状态、最后事件时间、最后错误。
- `actuator/executed`：动作是否成功、失败或取消。

## 架构分层

```text
OneBot 平台
  ↑ WebSocket / HTTP
OneBot Transport
  → 连接、超时、鉴权、指数退避重连
OneBot Protocol
  → 事件解析、消息段、Percept 映射
OneBot API Client
  → HTTP 动作、超时、有限重试
OneBot Body
  → BodyAdapter、状态、senses、actuators
Athena BodyRegistry
  → Percept 路由、Actuator 执行
Life / Mode
  → 产品行为
```

这个分层保证 OneBot 协议变化只影响这个包，Life 和 Mode 只依赖 Athena 自己的 Body 契约。反过来，Athena 也不去理解 QQ、群、撤回这些平台语义，那些语义在 Percept 和 Actuator 边界上已经被翻译成通用结构。

## 非目标

OneBot Body 不负责：

- Chat、World、Interlude 等 Mode 的对话、记忆、世界状态策略。
- 多账号业务编排。
- 消息权限、跨会话投递权限。
- 消息归档与持久化。
- Koishi Session 或其他框架的会话语义。

这些应该由 Mode、DeliveryPolicy、StateProvider 或更高层应用负责。

## 本地开发

```bash
corepack yarn workspace @yesimbot/onebot-body typecheck
corepack yarn workspace @yesimbot/onebot-body test
corepack yarn workspace @yesimbot/onebot-body build
```

测试覆盖事件解析、消息段归一化、Percept 映射、HTTP 动作与重试边界、Body 生命周期和连接失败回滚。
