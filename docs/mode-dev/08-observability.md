# 08 可观测性

## 这一节解决什么问题

Mode 运行时会做很多事：

- 收到 Percept。
- 拒绝 Percept。
- 调用 Actuator。
- 切换模型。
- 创建和销毁 Life。
- 产生流式输出。

如果这些过程不可见，开发时很难知道 Mode 到底发生了什么。

可观测性就是让这些过程变成事件，供日志、调试、WebUI 使用。

## Life 事件

Life 生命周期事件：

```text
life/created
life/disposed
life/error
```

用途：

- 创建 Life 时记录。
- 销毁 Life 时记录。
- 异步路由出错时记录。

## Percept 事件

Percept 路由事件：

```text
body/percept
percept/routed
percept/rejected
```

`body/percept` 是 Body 发出的原始事件。

`percept/routed` 表示事件被成功路由到 Mode。

`percept/rejected` 表示事件被拒绝。

拒绝原因：

- `attention`
- `capabilities`
- `no-mode`
- `hook`

## Actuator 事件

```text
actuator/executed
```

包含：

- bodyId
- actuatorId
- result
- attempt

## Model 事件

```text
model/changed
model/error
```

用途：

- 模型切换成功。
- 模型 provider 失败。
- failover 过程。

## AgentLoop 事件

```text
agent/stream-part
agent/output
```

`agent/stream-part` 是流式输出片段。

`agent/output` 是完整 assistant 输出。

这些事件适合做：

- 打字机效果。
- WebUI 输出。
- 调试模型返回。

## Mode 事件

```text
mode/disposed
```

用途：

- 插件卸载时释放 Mode。
- 记录 Mode 生命周期。

## 监听示例

```ts
ctx.on("percept/routed", (event) => {
  console.log(event.id, event.modeId, event.handled);
});

ctx.on("percept/rejected", (event) => {
  console.log(event.id, event.reason);
});

ctx.on("actuator/executed", (event) => {
  console.log(event.bodyId, event.actuatorId, event.result.status);
});

ctx.on("agent/stream-part", (event) => {
  console.log(event.agentId, event.part);
});
```

## 你现在应该理解什么

- 可观测性通过事件表达。
- 每个关键过程都有对应事件。
- 事件适合日志、调试、WebUI。
- Mode 开发时应该监听 rejected 和 error 事件。
