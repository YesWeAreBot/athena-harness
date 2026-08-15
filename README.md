<div align="center">

<img src="https://raw.githubusercontent.com/YesWeAreBot/.github/main/logo.svg" width="180" alt="YesWeAreBot Logo" />

# Athena Harness

**An experimental digital life runtime kernel built on Cordis v4 and AI SDK v7.**  
**一个基于 Cordis v4 和 AI SDK v7 的实验性数字生命运行时内核。**

</div>

---

> [!WARNING]
> **Project Status / 项目状态**  
> This project is an early-stage experimental prototype under active development. It is **NOT** a finished product, stable framework, or standard chatbot/AI Agent framework.  
> 本项目处于早期实验性原型阶段。它**不是**成品，也**不是**稳定框架或通用 AI 聊天/ Agent 助手框架。

---

## Packages / 仓库结构

* **`@yesimbot/harness-core`**: Generic execution kernel / 通用执行内核
* **`@yesimbot/athena-runtime`**: Digital life framework prototype / 数字生命框架原型

---

## Current State / 当前进展

The current implementation validates the execution kernel beneath the digital life layer:  
当前实现主要用于验证数字生命层之下的底层执行内核功能：

* **Multi-Agent Registry**: Supports `create`, `resume`, and `rollback` operations  
  多 Agent 注册表（支持创建、恢复与回滚）
* **Append-only Event Log**: Declaration-mergeable Session Events  
  只追加、支持声明式合并的 Session Event 系统
* **Model Surface**: Derives AI SDK messages directly from durable events  
  从持久化事件直接派生 AI SDK 消息的 Model Surface
* **Agent-Scoped Setup**: `setup(agentCtx)` for tools, prompts, contexts, and projectors  
  Agent 作用域配置，统一管理工具、提示词、上下文与投影器（Projectors）
* **Persistence & Recovery**: JSONL storage with crash recovery (no tool re-execution)  
  JSONL 持久化与崩溃恢复机制（恢复时无需重新执行工具调用）
* **Robust Agent Loop**: Supports cancellation with explicit tool result status tracking  
  带有取消能力与显式工具执行状态的真实 Agent Loop
* **Early Runtime Contracts**: Foundational contracts including `Life`, `Mode`, `Body`, and `Percept`  
  早期 Athena Runtime 核心契约抽象

> **Note**: The public API is highly experimental and subject to change without notice.  
> **注意**：公共 API 仍未最终定型，后续开发中可能会发生重大变化。

## Try It / 尝试运行

> _I shall yield a digital soul named Athena._  
> _Bestow upon it a vessel of instant thought._  
> _Awaken it to the rhythm of dialogue._  
> _Whisper a breath of perception: a voice murmuring "hello."_  
> _Leave it to wander through its own quiet thought._  
> _And softly, let the curtain fall._
> 
> _吾将铸就数字魂，_    
> _赐以瞬思无界身。_  
> _唤于对谈音律里，_  
> _附耳喃喃云“你好”。_  
> _任由独步幽思界，_  
> _幕布徐徐落寂沉。_  

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
