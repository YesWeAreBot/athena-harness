<div align="center">

<img src="https://raw.githubusercontent.com/YesWeAreBot/.github/main/logo.svg" width="180" alt="YesWeAreBot Logo" />

# Athena Harness

**A canonical Agent Loop execution kernel built on Cordis v4 and AI SDK v7.**
**一个基于 Cordis v4 和 AI SDK v7 的通用 Agent Loop 执行内核。**

</div>

> [!WARNING]
> **Project Status / 项目状态**  
> This project is an early-stage experimental prototype under active development. It is **NOT** a finished product, stable framework, or standard chatbot/AI Agent framework.  
> 本项目处于早期实验性原型阶段。它**不是**成品，也**不是**稳定框架或通用 AI 聊天/Agent 助手框架。

## Canonical Packages / 核心包

The canonical Harness Core is the six-package `@athena/*` architecture defined in [2026-08-15-harness-core-design.md](./docs/spark/2026-08-15-harness-core-design.md).
核心架构是设计文档中的六包 `@athena/*` 体系。

- **`@athena/session`**: append-only event log, Surface projection, persistence interface / 追加式事件日志、Surface 投影与持久化接口
- **`@athena/tools`**: descriptor-only tools, per-agent scope, ToolGate / descriptor-only 工具、Agent 作用域与 ToolGate
- **`@athena/prompt`**: ordered system prompt sections and fingerprints / 有序 System Prompt 与指纹去重
- **`@athena/agent`**: Agent interface, two-slot Inbox, AgentFactory seam / Agent 接口、两槽 Inbox 与 AgentFactory 替换缝
- **`@athena/agent-loop`**: default React Loop implementation / 默认 React Loop 实现
- **`@athena/persist-jsonl`**: JSONL Session persistence / JSONL Session 持久化

The legacy `@yesimbot/harness-core` source is archived under `legacy/harness-core`; `@yesimbot/athena-runtime` remains as a historical prototype reference and is not part of the canonical design.
旧版 `@yesimbot/harness-core` 源码已归档到 `legacy/harness-core`；`@yesimbot/athena-runtime` 仍保留为历史原型参考，不属于当前 canonical 设计。

## Current State / 当前进展

The six `@athena/*` packages implement the canonical core design with tests.
当前六个 `@athena/*` 包已按 canonical 设计实现并带测试。

- **Append-only Session**: durable event log with write-time invariants / 追加式 Session 事件日志，写入期不变量强制校验
- **Surface projection**: model-visible view derived from events via `surfaceOp` / 由事件通过 `surfaceOp` 派生模型可见视图
- **Descriptor-only tools**: model sees tool descriptors; Loop executes tools / 模型只看到工具描述，Loop 负责执行
- **Intent before side-effect**: `tool/call` is flushed before `tool.execute()` / 工具意图先落盘，再执行副作用
- **Two-slot Inbox**: `followup` / `steer` / `inject` semantics / 两槽 Inbox 的 followup/steer/inject 语义
- **AgentFactory seam**: replaceable Agent Loop / 可替换的 AgentFactory Agent Loop 缝
- **JSONL persistence**: create / open / prepare roundtrip / JSONL 持久化的创建、打开与恢复

> **Note**: The public API is highly experimental and subject to change without notice.  
> **注意**：公共 API 仍未最终定型，后续开发中可能会发生重大变化。

## Quick Start / 快速开始

```ts
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import { SystemPrompt } from "@athena/prompt";
import { AgentRegistry } from "@athena/agent";
import { AgentLoop } from "@athena/agent-loop";
import { PersistJsonl } from "@athena/persist-jsonl";
import { mkdir } from "node:fs/promises";
import { Context } from "cordis";

const sessionsDir = "./sessions";
await mkdir(sessionsDir, { recursive: true });

const ctx = new Context();
await Promise.all([
  ctx.plugin(SessionRegistry),
  ctx.plugin(ToolRegistry),
  ctx.plugin(SystemPrompt),
  ctx.plugin(AgentRegistry),
  ctx.plugin(AgentLoop),
  ctx.plugin(PersistJsonl({ dir: sessionsDir })),
]);

const handle = await ctx.agents.create({
  model: myLanguageModel,
  maxSteps: 10,
  setup(agentCtx) {
    // register scoped tools and prompt sections here
  },
});

handle.agent.followup({ role: "user", content: "Hello!" });
await handle.agent.whenIdle();
await handle.dispose();
```

This creates an Agent, sends one user message, waits for its Turn to finish, and closes the Session.
示例创建一个 Agent，发送一条用户消息，等待 Turn 完成，然后释放资源。

## Architecture / 架构

Strict downward dependencies.
依赖严格向下。

```text
persist-jsonl  ->  session
agent-loop     ->  agent, session, tools, prompt
agent          ->  session
prompt         ->  cordis
tools          ->  cordis, ai types
session        ->  cordis, ai types
```

- **Session**: append-only execution log and single source of truth / 追加式执行日志与唯一事实源
- **Surface**: pure projection of the event log / 事件日志的纯投影
- **Turn**: bounded Agent activation / 有边界的 Agent 激活
- **Step**: one model request and its direct results / 一次模型请求及其直接结果
- **AgentLoop**: complete control strategy for one Turn / 一个 Turn 的完整控制策略
- **AgentKey**: symbol used for per-agent tools and prompt scope / 用于 per-agent 工具与 Prompt 作用域的 symbol
- **Inbox**: two-slot input buffer decoupled from the execution latch / 与执行闩解耦的两槽输入缓冲

## Docs / 文档

- [Canonical spec / Canonical 设计](./docs/spark/2026-08-15-harness-core-design.md)
- [Context map / 上下文地图](./CONTEXT-MAP.md)
- [Usage guide / 使用指南](./docs/features/README.md)
- [Mode developer docs / Mode 开发者文档](./docs/mode-dev/README.md)
- [OneBot Body / OneBot Body](./packages/onebot-body/README.md)
- [ADRs / 架构决策](./docs/adr/)
- [Archive / 归档原型](./docs/archive/README.md)
