# 03 Percept 与 Actuator

## 这一节解决什么问题

数字生命不能只活在代码里。它需要感知外部世界，也需要对外部世界施加动作。

这里的“外部世界”不是某一个平台，而是所有可能的平台和环境的抽象。

- 收到 QQ 消息是外部刺激。
- 看到 Minecraft 世界变化是外部刺激。
- 定时心跳也是外部刺激。
- 发消息是动作。
- 移动是动作。
- 打开应用是动作。

Athena 用 Percept 表达“刺激”，用 Actuator 表达“动作”。

## Percept 是什么

Percept 是一条外部事件。

它不是聊天消息，而是一个通用的事件信封。聊天消息只是其中一种 Percept。

一条 Percept 至少包含：

- `id`：唯一编号。
- `time`：发生时间。
- `bodyId`：来自哪个 Body。
- `kind`：事件类型。
- `data`：事件内容。

```ts
interface PerceptEvent<T = unknown> {
  id: string;
  time: number;
  bodyId: string;
  kind: string;
  data: T;
}
```

为了支持更复杂的场景，Percept 还允许附加：

- `source`：来源。
- `priority`：优先级。
- `expiresAt`：过期时间。
- `actor`：发起者。
- `target`：目标。
- `attachments`：媒体附件。
- `meta`：其他元数据。

这些字段都是可选的。简单场景只需要 `id/time/bodyId/kind/data`。

## Life 怎么路由 Percept

Life 收到 Percept 后，不会直接把事件塞给 Mode。

它先经过一条路由管线：

```text
PerceptPipeline.attention
  → PerceptPipeline.compact
  → Mode capabilities
  → Mode hooks.onPercept
  → Mode.handle
```

每一步的作用：

- `attention`：决定这个 Percept 值不值得关注。
- `compact`：把原始事件归一化成 Mode 真正看到的事件。
- capabilities：检查 Mode 是否声明关心这个 `bodyId + kind`。
- hooks：运行 Mode 自己的前置逻辑。
- handle：Mode 最终处理。

## Mode 怎么声明关心哪些 Percept

Mode 通过 `ModePerceptInterest` 声明兴趣：

```ts
capabilities: {
  percepts: [
    { body: "minecraft", kind: "world/observation" },
    { body: "im", kind: "message-created" },
  ],
}
```

如果 Mode 没有声明 capabilities，Life 会默认放行。

如果 Mode 声明了 capabilities，但 Percept 不匹配，Life 会拒绝路由并发 `percept/rejected`。

## 怎么发送 Percept

外部适配器或测试代码可以通过 Life 发送 Percept：

```ts
await handle.dispatchPercept({
  id: "p1",
  time: Date.now(),
  bodyId: "im",
  kind: "message-created",
  data: { text: "hi" },
});
```

## 主动唤醒

不是所有行为都由外部事件触发。

Life 允许主动唤醒 Mode：

```ts
await handle.wake("world.tingle", { time: Date.now() });
```

`wake` 会被转换成一条 `bodyId: "life"`、`kind: "wake"` 的 Percept，然后走同一条路由管线。

## Actuator 是什么

Actuator 是 Life 对外部世界执行的动作。

它和 Percept 相对：

- Percept 是“世界告诉 Life 发生了什么”。
- Actuator 是“Life 告诉世界做什么”。

Actuator 返回统一的 `ActuatorResult`：

```ts
type ActuatorStatus = "ok" | "error" | "canceled";

interface ActuatorResult {
  status: ActuatorStatus;
  output?: unknown;
  error?: unknown;
  retryable?: boolean;
}
```

## Mode 怎么调用 Actuator

Mode 通过 `ctx.bodies.act()` 调用：

```ts
const result = await ctx.bodies?.act("im", "send", {
  content: "你好",
});

if (result.status === "ok") {
  // 已发送
} else if (result.status === "error" && result.retryable) {
  // 可以重试
}
```

Life 会根据 Mode capabilities 的 `actuators` 判断是否允许调用。

## Actuator 上下文

Actuator 在执行时能看到一个上下文：

```ts
interface ActuatorContext {
  bodyId: string;
  signal?: AbortSignal;
  attempt: number;
  lifeId?: string;
  modeId?: string;
  delivery?: unknown;
  media?: unknown;
}
```

用途：

- `signal`：支持取消。
- `attempt`：当前第几次尝试。
- `lifeId/modeId`：知道是谁在调用。
- `delivery/media`：把投递和媒体能力传给 Actuator。

## 权限

DeliveryProvider 可以用 `canDeliver(target)` 控制自己能处理哪些目标：

```ts
const provider = {
  id: "im-delivery",
  kinds: ["message"],
  canDeliver: (target) => target.channel === "allowed-channel",
  deliver: async (target, payload) => ({
    id: crypto.randomUUID(),
    status: "delivered",
  }),
};
```

全局权限可以注册到 `ctx.deliveryPolicies`。

## 你现在应该理解什么

- Percept 是输入，Actuator 是输出。
- Percept 会经过 Life 的路由管线。
- Mode 通过 capabilities 声明兴趣。
- Actuator 返回统一结果，方便重试和取消。
- 输出投递有 provider 本地策略和全局策略两层。
