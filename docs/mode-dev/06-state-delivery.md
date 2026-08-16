# 06 State 与 Delivery

## 这一节解决什么问题

Mode 不能只是一个“无状态的函数”。

World Mode 需要记住世界状态。

Interlude Mode 需要记住 Story、参与者关系、未完成的意图。

同时，Mode 的产出也不只是“调用一次函数”。

它可能需要：

- 延迟发送。
- 发到另一个 conversation。
- 检查有没有权限发送。
- 在重启后恢复尚未发送的投递。

这一节解释两件事：

1. 状态归谁。
2. 输出怎么安全地投递。

## State 归谁

Mode 的状态属于 Mode。

但 Life 负责状态的恢复和释放顺序。

为什么？

因为 Life 需要知道：

- 什么时候恢复状态。
- 什么时候持久化状态。
- 切换 Mode 时旧状态要不要保存。
- Mode 销毁时状态怎么处理。

如果每个 Mode 偷偷维护状态，Life 无法保证这些顺序。

## ModeStateProvider

ModeStateProvider 是 Mode 状态能力的抽象。

```ts
interface ModeStateProvider {
  id: string;
  kinds: ModeStateKind[];
  get(): Awaitable<unknown>;
  set?(next: unknown): Awaitable<void>;
  restore?(lifeId: string): Awaitable<void>;
  persist?(lifeId: string): Awaitable<void>;
  dispose?(): Awaitable<void>;
}
```

含义：

- `get/set`：读写当前状态。
- `restore`：从自己的持久化恢复。
- `persist`：把自己的状态持久化。
- `dispose`：释放资源。

## Life 的状态顺序

Life 保证：

```text
Mode 启动前
  → restore

Mode 切换时
  → persist 旧 Mode
  → restore 新 Mode

Mode dispose 时
  → persist
  → dispose
```

这意味着 Mode 不需要自己处理“切换前保存”和“启动前恢复”。

## JsonlStateProvider

athena-runtime 提供一个 JSON 持久化后端。

```ts
import { JsonlStateProvider } from "@yesimbot/athena-runtime";

const provider = new JsonlStateProvider({
  id: "story-state",
  root: "./data/states",
  kinds: ["story"],
});
```

它会把每个 Life 的状态写入一个 JSON 文件。

Life 统一入口：

```ts
await handle.getState("story-state");
await handle.setState("story-state", { arc: "arc-1" });
```

## Delivery 是什么

Delivery 是 Mode 输出到外部世界的投递能力。

它比 Actuator 更偏“目标投递”：

- Actuator 负责“执行动作”。
- Delivery 负责“把结果送到正确的目标，并知道结果如何”。

## ModeDeliveryProvider

```ts
interface ModeDeliveryProvider {
  id: string;
  kinds: ModeDeliveryKind[];
  canDeliver?(target: unknown): boolean;
  deliver?(target: unknown, payload: unknown): Awaitable<ModeDeliveryReceipt>;
  schedule?(delivery: ModeDeliverySchedule): Awaitable<ModeDeliveryReceipt>;
  cancel?(id: string): Awaitable<boolean>;
  dispose?(): Awaitable<void>;
}
```

## 投递回执

投递不一定立即成功。

它可能：

- 已经送达。
- 被延迟到未来。
- 失败。

所以投递返回回执：

```ts
interface ModeDeliveryReceipt {
  id: string;
  status: "delivered" | "delayed" | "failed";
  scheduledAt?: number;
  error?: unknown;
}
```

## Life 统一投递入口

```ts
await handle.deliver("message", { channel: "123" }, { text: "hi" });
```

延迟投递：

```ts
await handle.scheduleDelivery({
  kind: "message",
  target: { channel: "123" },
  payload: { text: "稍后发送" },
  at: Date.now() + 60_000,
});
```

取消：

```ts
await handle.cancelDelivery("delivery-id");
```

## canDeliver：目标权限

DeliveryProvider 可以声明自己能处理哪些目标：

```ts
const provider = {
  id: "im-delivery",
  kinds: ["message"],
  canDeliver: (target) => target.channel === "allowed",
  deliver: async (target, payload) => ({
    id: crypto.randomUUID(),
    status: "delivered",
  }),
};
```

## DeliveryPolicyRegistry：全局权限

如果权限策略跨多个 provider，可以使用全局 registry。

```ts
ctx.plugin(deliveryPolicyRegistry);

ctx.deliveryPolicies.register("block-private", ({ target }) => {
  return target.channel !== "private-blocked";
});
```

权限策略在 provider 选择之前执行。

## DeliveryQueue：持久化延迟投递

延迟投递不能只存在内存里。

如果进程重启，投递应该还能恢复。

`DeliveryQueue` 解决这个问题：

```ts
import { DeliveryQueue } from "@yesimbot/athena-runtime";

const queue = new DeliveryQueue({
  root: "./data/deliveries",
  provider: chatDeliveryProvider,
});
```

`schedule` 会写入本地文件，到期后触发底层 provider 实际投递。

重启后会恢复 pending 投递并重新计时。

## 你现在应该理解什么

- 状态属于 Mode，但生命周期由 Life 管理。
- Life 会按固定顺序 persist/restore。
- Delivery 返回回执，支持 delivered/delayed/failed。
- canDeliver 是 provider 本地权限。
- DeliveryPolicyRegistry 是全局权限。
- DeliveryQueue 解决延迟投递的持久化和恢复。
