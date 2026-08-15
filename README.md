# Athena Harness

An experimental digital life runtime kernel built on **Cordis v4** and **AI SDK v7**.

一个基于 **Cordis v4** 和 **AI SDK v7** 的实验性数字生命运行时内核。

This project is unfinished. It is an experimental prototype, not a product, not a stable framework, and not a chatbot or AI agent assistant framework.

本项目尚未完成。它是实验性原型，不是成品，不是稳定框架，也不是聊天机器人或 AI Agent 助手框架。

## Repository / 仓库

- `@yesimbot/harness-core`: generic execution kernel / 通用执行内核
- `@yesimbot/athena-runtime`: digital life framework prototype / 数字生命框架原型

## Current State / 当前状态

Early prototype. The current implementation proves the execution kernel beneath the digital life layer:

早期原型。当前实现用于验证数字生命层之下的执行内核：

- multi-Agent registry with create/resume/rollback（多 Agent 注册、创建/恢复/回滚）
- append-only, declaration-mergeable Session Events（只追加、可声明合并的 Session Events）
- Model Surface that derives AI SDK messages from durable events（从持久化事件派生 AI SDK 消息的 Model Surface）
- Agent-scoped `setup(agentCtx)` for tools, prompts, context, and projectors（用于工具、提示词、上下文和 projector 的 Agent 作用域 `setup(agentCtx)`）
- JSONL persistence, restoration, and crash recovery without tool replay（JSONL 持久化、恢复和不重放工具的崩溃恢复）
- a real Agent Loop with cancellation and explicit tool result status（带取消和显式工具结果状态的真实 Agent Loop）
- early Athena Runtime contracts: Life, Mode, Body, Percept（早期 Athena Runtime 契约：Life、Mode、Body、Percept）

The public API is not settled and may change as the project continues.

公共 API 尚未定型，后续可能变化。

## Try It / 尝试运行

```ts
import { sessionStore } from "@yesimbot/harness-core";
import { bodyRegistry, lifeRegistry, modeRegistry } from "@yesimbot/athena-runtime";
import { Context } from "cordis";

const ctx = new Context();
await Promise.all([ctx.plugin(sessionStore), ctx.plugin(bodyRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)]);

ctx.modes.register({
  name: "chat",
  setup: async () => ({
    handle: async (event) => {
      console.log(event.kind, event.data);
      return true;
    },
  }),
});

ctx.bodies.register({
  id: "im",
  state: {},
});

const athena = ctx.lives.create({ id: "athena-1" });
await athena.attachBody("im");
await athena.setMode(await ctx.modes.create("chat", {}));

ctx.bodies.dispatch("im", "message-created", { text: "hello" });
await new Promise((resolve) => setTimeout(resolve, 0));

await ctx.lives.dispose("athena-1");
```

This is the current Athena Runtime prototype: create a Life named Athena, attach a Body, activate a Mode, and route a Percept. It is not a complete digital life yet; Memory, Actuators, and automatic Life-to-AgentLoop wiring are unfinished.

这是当前 Athena Runtime 原型：创建一个名为 Athena 的 Life，连接一个 Body，激活一个 Mode，并路由一个 Percept。它还不是完整的数字生命；Memory、Actuators 和 Life 到 AgentLoop 的自动接线仍未完成。

## Docs / 文档

- [Architecture foundation / 架构基线](./docs/architecture-foundation.md)
- [Harness core design / Core 设计](./docs/design.md)
- [Athena Runtime design / 运行时设计](./docs/athena-runtime-design.md)
- [Feature guides / 功能指南](./docs/features/README.md)
- [Contract stability / 契约稳定性](./docs/contract-stability.md)
- [Vision / 愿景](./docs/vision.md)
- [Positioning / 定位](./docs/positioning.md)
