# 02 Mode 生命周期

## 这一节解决什么问题

Mode 不是“一个函数”，而是“一个会启动、运行、停止、释放的运行单元”。

如果你只写 `handle(event)`，那么：

- 谁来创建它？
- 谁来停止它？
- 切换 Mode 时旧 Mode 的资源怎么释放？
- 新 Mode 需要的数据怎么恢复？
- 插件卸载时 Mode 会不会泄漏？

这些问题都由 Life 统一解决。Mode 只需要声明自己需要什么，并实现生命周期方法。

## 什么是 Mode 定义

Mode 定义是“如何创建一个 Mode 的说明书”。

它包含：

- 名字。
- 能力声明。
- 创建函数 `setup`。

```ts
interface Mode {
  name: string;
  description?: string;
  capabilities?: ModeCapabilities;
  setup(ctx: ModeContext, config: unknown): Awaitable<ModeSetupHandle>;
}
```

`setup` 是 Mode 的入口。它收到 Life 提供的 `ModeContext`，并返回 `ModeSetupHandle`。

## 什么是 ModeSetupHandle

`ModeSetupHandle` 是 Mode 实例的运行句柄。

它包含：

- 生命周期方法。
- Percept 处理方法。
- Hooks。
- Providers。

```ts
interface ModeSetupHandle {
  start?(): Awaitable<void>;
  stop?(): Awaitable<void>;
  handle?(event: PerceptEvent): Awaitable<boolean>;
  dispose?(): Awaitable<void>;
  hooks?: ModeHooks;
  providers?: ModeProviders;
}
```

## capabilities：声明你要什么

`capabilities` 是 Mode 对 Life 的声明。

它不实现逻辑，只告诉 Life：

- 这个 Mode 是什么驱动类型。
- 它关心哪些 Percept。
- 它能使用哪些 Actuator。
- 它需要哪些调度类型。
- 它需要哪些记忆类型。
- 它需要哪些状态和投递能力。

```ts
capabilities: {
  driver: "finite-tool-loop",
  percepts: [{ body: "im", kind: "message-created" }],
  actuators: [{ body: "im", actuator: "send" }],
  scheduling: ["event"],
  memory: ["facts"],
  productState: ["channel"],
}
```

Life 会利用这些声明：

- 决定是否把 Percept 路由给当前 Mode。
- 决定 Mode 能否调用某个 Actuator。
- 为后续 provider 选择提供依据。

## hooks：在 handle 之前干预

`hooks.onPercept` 是 Percept 进入 `handle` 之前的一次拦截机会。

它适合做：

- 审计。
- 限流。
- 权限判断。
- 事件日志。
- 把 Percept 转换给 `handle` 前的前置处理。

```ts
hooks: {
  onPercept: async (event, hookContext) => {
    console.log(hookContext.modeId, event.kind);
    return true;
  },
}
```

返回 `false` 表示拒绝这条 Percept。

## providers：把实现交给 Life 管理

Mode 可能需要：

- 自己的 MemoryProvider。
- 自己的 ModelProvider。
- 自己的 StateProvider。
- 自己的 DeliveryProvider。
- 自己的 SchedulerProvider。
- 自己的 MediaProvider。

这些 provider 都通过 `providers` 返回给 Life。

```ts
providers: {
  memory: chatMemoryProvider,
  model: chatModelProvider,
  state: chatStateProvider,
  delivery: chatDeliveryProvider,
  scheduler: chatSchedulerProvider,
  media: chatMediaProvider,
}
```

Life 负责：

- 注册 MemoryProvider。
- 启动前调用 state/memory 的 `restore`。
- 切换时 persist 旧状态、restore 新状态。
- dispose 时调用 provider 的 `persist/cancelAll/dispose`。

这样 Mode 不自己偷偷创建全局资源，也不会在卸载时留下泄漏。

## 生命周期顺序

一个 Mode 的完整生命周期是：

```text
createMode
  → setup()
  → register providers
  → restore state/memory
  → start()

switch Mode
  → persist 旧 Mode state
  → stop 旧 Mode
  → restore 新 Mode state
  → start 新 Mode

dispose Mode
  → stop()
  → dispose()
  → persist state
  → cancelAll scheduler
  → dispose providers
```

## 代码：一个完整 Mode

下面这个 Mode 演示：

- 声明 capabilities。
- 使用 scheduler。
- 提供 memory 和 state provider。
- 实现 start/stop/dispose。

```ts
const mode: Mode = {
  name: "world",
  capabilities: {
    driver: "continuous-mailbox",
    percepts: [],
    actuators: [],
    scheduling: ["tingle"],
    memory: ["world", "facts"],
    productState: ["world"],
  },
  setup: async (ctx) => {
    ctx.scheduler?.schedule({
      kind: "tingle",
      after: 1000,
      run: async () => {
        await ctx.life?.wake("world.tingle");
      },
    });

    return {
      start: async () => {
        // Mode 启动后的初始化
      },
      stop: async () => {
        // Mode 停止前的清理
      },
      dispose: async () => {
        // 最终释放
      },
      providers: {
        memory: worldMemoryProvider,
        state: worldStateProvider,
      },
    };
  },
};
```

## 你现在应该理解什么

- Mode 是运行单元，不是纯函数。
- capabilities 告诉 Life“我能做什么”。
- hooks 提供运行期干预。
- providers 把实现交给 Life 统一管理。
- start/stop/dispose 是资源边界。

下一节解释 Percept 和 Actuator。
