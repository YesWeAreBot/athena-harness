# Feature Specification: Design Philosophy & Positioning

**Feature Branch**: `design-philosophy`

**Created**: 2026-08-18

**Status**: Draft

**Input**: Discussion on how Athena Harness differentiates from Koishi (bot framework) and AstrBot (LLM chat platform), establishing the framework's irreducible core and the capabilities it must provide that neither alternative can express.

---

## Core Positioning

Athena Harness is:
- **专为拟人 AI / 数字生命设计的框架内核与工具包**
- 为 YesImBot、YesImBotWorld、HDS-Interlude 提供可复用、可扩展、可组合的基础设施
- 未来可支撑 IM 之外的场景（Minecraft、Live2D、物理身体等）

Athena Harness is NOT:
- 不是领域无关的通用 Agent 执行层（区别于 agent-runtime）
- 不是又一个 bot 框架（区别于 Koishi / AstrBot / deepseek-harness）
- 不是 LLM 消息处理管道（区别于 AstrBot 的 pipeline 模式）

---

## Comparative Analysis

### vs Koishi: Same Foundation, Different Organizing Principle

#### Surface Similarity

| | Koishi | Athena |
|---|---|---|
| Composition substrate | Cordis | Cordis |
| IM protocol | Satori | Satori |
| Plugin mechanism | Cordis plugin lifecycle | Cordis plugin lifecycle |
| Event delivery | Cordis events | Cordis events |

The technology stack is identical. The difference is in **what the framework assumes about its users and the entities it serves**.

#### Koishi's Core Assumption

> **External event → framework processing pipeline → response**

Koishi's entire architecture serves this assumption:
- `Session` = one-shot event snapshot (message arrives → process → reply → done)
- Middleware chain = linear input→transform→output pipe
- Command system = request/response pattern (user sends command → bot replies)
- Bot = passive entity (waits for events; never acts autonomously)

#### What Koishi Cannot Express

- An entity that is "alive" when no messages arrive
- Willingness-based response (deciding NOT to reply is a legitimate action)
- Cross-event continuous state beyond a single Session lifecycle
- "I exist through actions in a world, not through message replies"
- Multiple simultaneous existence dimensions (IM + Minecraft + Live2D)

#### Athena's Differentiator from Koishi

- **No event→response pipeline**: Framework does not provide middleware chain or command routing. Pulse fully self-determines how (or whether) to respond to events.
- **Autonomous timeline**: Pulse can have internal rhythm (heartbeat, timers, self-initiated actions) independent of external events.
- **LLM-native cognition**: The core cognitive mechanism is agent loop (multi-step reasoning, tool calling), not middleware chain processing.
- **Multi-capability existence**: IM events and Minecraft world changes and internal timers are equal-status input sources in the same event space.

#### Why Using Satori Does Not Make Us "Another Koishi"

Satori is used as a **library** (IM protocol implementation), not as the **framework's organizing center**. The core path is:

```
Koishi:  Session → middleware chain → command → response
Athena:  Spirit → Pulse → willingness/buffer/integration → multi-modal action (or inaction)
```

Analogy: Django and Flask both use WSGI/ASGI, but they are different frameworks with different organizing principles. Koishi and Athena both use Satori, but serve fundamentally different purposes.

---

### vs AstrBot: Both LLM-Powered, Different Existence Model

#### Surface Similarity

| | AstrBot | Athena |
|---|---|---|
| AI-native | Yes (LLM is the core processor) | Yes (LLM agent loop as cognition) |
| Multi-platform | Yes (QQ, Discord, WeChat, Telegram...) | Yes (via Satori adapters) |
| Tool calling | Yes (function tools, MCP) | Yes (three-layer tool model) |
| Persona | Yes (persona configuration) | Yes (Spirit persona) |
| Knowledge base | Yes (RAG, vector search) | Yes (Spirit memory) |
| Plugin system | Yes (Stars) | Yes (Cordis plugins) |

Both are AI-native chat platforms. The difference is in **the nature of the entity being served**.

#### AstrBot's Core Assumption

> **Every message passes through a fixed pipeline and produces a reply.**

AstrBot's architecture:
```
Platform → event_queue → Pipeline:
  WakingCheck → WhitelistCheck → SessionStatus → RateLimit
  → ContentSafety → PreProcess → Process(LLM) → ResultDecorate → Respond
```

This is the same request/response paradigm as Koishi, with LLM as the processor instead of command handlers.

#### What AstrBot Cannot Express

1. **No autonomous timeline** — Without incoming messages, no computation occurs. The entity cannot "decide to do something" on its own.
2. **No cross-message continuous existence** — Each message independently traverses the pipeline. No concept of "I am in the middle of a long-running activity."
3. **Bound to chat pipeline** — The stage chain (WakingCheck, RateLimit, ContentSafety, Respond) is designed exclusively for "message came, how to reply." Cannot naturally accommodate "I'm walking in Minecraft" or "I'm changing my Live2D expression."
4. **No multi-modal existence** — Platform is message source/reply target. No dimension of "I simultaneously exist in a 3D world."
5. **Agent is stateless** — A dataclass (name + instructions + tools). No persistent identity evolution, no memory accumulation framework, no self-model.
6. **Fixed pipeline** — 9 stages in fixed order. A fundamentally different cognitive mode (e.g., narrative-driven Interlude) requires rewriting the entire pipeline.

#### Athena's Differentiator from AstrBot

| Dimension | AstrBot | Athena |
|---|---|---|
| **Existence model** | Passive responder (message triggers pipeline) | Continuous being (has own timeline and rhythm) |
| **Cognitive unit** | One pipeline execution = one conversation turn | Pulse cycle = one moment of consciousness (may span multiple messages, may fire without messages) |
| **Identity** | Persona config (static prompt) | Spirit (continuously evolving memory + self-model) |
| **Action space** | Reply to message (+ tool calls as intermediate steps) | Multi-modal action (IM, world, expression, voice — Pulse integrates and dispatches) |
| **Temporal sense** | None (event-driven, no computation without events) | Yes (Pulse has heartbeat/rhythm, can act without input) |
| **Evolution** | None (knowledge base manually updated) | Spirit memory continuously accumulates, self-model auto-evolves |
| **Cognitive strategy** | Fixed pipeline (9 stages, unchangeable order) | Replaceable Pulse (entirely different cognitive packages: chat, world, interlude) |

---

## Irreducible Framework Primitives

To avoid degenerating into "Koishi + a big plugin" or "a smarter AstrBot," the framework MUST provide capabilities that neither Koishi plugins nor AstrBot Stars can independently implement:

### 1. Spirit Lifecycle & Memory Infrastructure

Not "configure a persona prompt" — framework-managed continuously evolving identity.

- Persistent identity across process restarts
- Memory accumulation infrastructure (vector, structured, hybrid)
- Self-model state ("I'm tired today," "I have an opinion about this")
- Memory survives Pulse changes (identity continuity across cognitive strategy changes)

**Why this can't be "just a plugin"**: Memory infrastructure requires cross-cutting persistence, indexing, retrieval, and lifecycle management that spans all other components. A plugin can't own the identity that other plugins (including Pulse) depend on.

### 2. Pulse as Replaceable Cognitive Unit

Not a fixed pipeline — an entirely replaceable, self-contained survival strategy.

- Pulse packages are independent products (`@athena/pulse-chat`, `@athena/pulse-world`, `@athena/pulse-interlude`)
- Each Pulse defines its own: rhythm, integration, cognition, enactment, continuation
- Framework enforces one-active-Pulse-per-Spirit constraint
- Pulse replacement preserves Spirit state (memory, persona)

**Why this can't be "just a plugin"**: A plugin operates within a fixed framework structure. Pulse IS the structure — it determines the entire cognitive loop. The framework must provide the mounting point, lifecycle, and contract for Pulse without constraining its internal organization.

### 3. Multi-Capability Unified Event Space

Not "IM adapter + maybe other adapters" — truly equal-status multiple existence dimensions.

- IM events, world state changes, timer events, internal state changes coexist in the same Cordis context
- Pulse freely subscribes to any combination of event sources
- Framework provides no pipeline that assumes "input is a message"
- Adding a new existence dimension (Minecraft, Audio) is adding a Service, not forking the framework

**Why this can't be "just a plugin"**: If the framework's core path assumes message→response (like Koishi's middleware or AstrBot's pipeline), non-chat capabilities are always second-class citizens bolted on the side. The framework must be structurally neutral about input sources.

### 4. Autonomous Rhythm

Not "responds when spoken to" — framework-native support for self-initiated cognition.

- Pulse can fire cognitive cycles without external events
- Timer/scheduler primitives available to Pulse
- "No response" is a first-class decision (willingness threshold not met)
- "Proactive action" is a first-class behavior (not a hack on top of event-driven architecture)

**Why this can't be "just a plugin"**: In event-driven frameworks (Koishi, AstrBot), no-event = no-computation. A timer plugin can fake autonomy, but the framework's lifecycle management, resource allocation, and observability don't account for unprompted computation. Athena treats autonomous cognition as normal operation, not an edge case.

---

## The Degeneration Test

Athena has degenerated into "another Koishi/AstrBot" if any of the following become true:

1. ❌ Spirit is just a config file that Pulse reads at startup (no framework-managed lifecycle)
2. ❌ Pulse is just a plugin that subscribes to events (no replaceable-unit contract or one-per-Spirit enforcement)
3. ❌ Non-IM capabilities are second-class (require special handling vs. IM being the "normal" path)
4. ❌ The framework assumes event→response as its core flow (making autonomous behavior an afterthought)
5. ❌ Memory/persona are static (no framework infrastructure for evolution)

Conversely, Athena succeeds as a distinct framework if:

1. ✅ A World Pulse (continuous heartbeat, no external trigger needed) works as naturally as a Chat Pulse
2. ✅ Swapping Pulse packages changes the entire cognitive strategy while preserving identity
3. ✅ Minecraft events and IM messages are consumed through identical mechanisms
4. ✅ An entity can exist for hours without receiving any message and still "be alive" (evolving, remembering, occasionally acting)
5. ✅ Spirit memory demonstrably evolves across interactions without manual intervention

---

## What We Intentionally Share with Koishi/AstrBot

Sharing infrastructure is a **strength**, not a weakness:

- **Cordis** as composition substrate — proven, stable, powerful plugin lifecycle
- **Satori** as IM protocol — mature adapter ecosystem, don't reinvent
- **Command/permission systems** (future) — may reference Koishi's implementations where appropriate
- **LLM tool calling patterns** — common AI SDK patterns

Using the same bricks doesn't make the same building. The organizing principle — what the framework assumes, enforces, and enables — is what distinguishes frameworks.

---

## Summary: The One-Sentence Differentiator

| Framework | One-sentence identity |
|---|---|
| **Koishi** | Plugin platform for building feature-rich chat bots |
| **AstrBot** | LLM-powered message processing pipeline for AI chat |
| **Athena** | Runtime kernel for digital beings that exist continuously across multiple dimensions |

The key word is **exist**. Koishi builds bots that *respond*. AstrBot builds AI that *chats*. Athena builds entities that *live*.

---

## Design Decisions

### Decided

1. **Framework is structurally neutral about input sources.** No built-in assumption that "input is a message" or that processing follows a fixed pipeline. Rationale: multi-modal existence requires equal-status event sources.

2. **Autonomous cognition is normal operation.** Pulse firing without external events is a designed-for case, not an edge case or hack. Rationale: World Pulse and proactive behaviors are core use cases, not extensions.

3. **Spirit is a framework-managed entity, not a config file.** The framework provides memory infrastructure, persistence, evolution mechanisms. Rationale: identity continuity across Pulse changes and process restarts requires framework-level lifecycle management.

4. **Pulse is a replaceable whole unit with a framework contract.** The framework defines the mounting interface; Pulse defines everything inside. Rationale: three radically different products (Chat, World, Interlude) must coexist on one framework without the framework favoring any one pattern.

5. **Shared infrastructure (Cordis, Satori) is explicitly embraced.** Using the same foundation as Koishi is intentional and documented. Rationale: proven infrastructure should be reused; differentiation comes from organizing principles, not from reinventing transport layers.

6. **Future command/permission systems may reference Koishi's implementations.** This does not make Athena "another Koishi" because these are shared utilities, not the framework's core identity. Rationale: practical reuse over ideological purity.

### Open for Future Resolution

- Exact Spirit memory infrastructure (vector DB? structured storage? hybrid?)
- Self-model representation and evolution mechanism
- Pulse contract interface specification (what must a Pulse provide to the framework?)
- How framework-level observability (Execution Record) captures autonomous cognition cycles
- Whether the "degeneration test" should be formalized as acceptance tests
