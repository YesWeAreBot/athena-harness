# Feature Specification: Satori-as-Capability Architecture

**Feature Branch**: `satori-capability-architecture`

**Created**: 2026-08-18

**Status**: Draft

**Input**: Architecture discussion on how Satori's unified IM protocol can serve as the messaging capability for Athena Harness, informed by analysis of Satori/Koishi source code, Cordis capability plugin, and the existing Spirit–Pulse–Medium domain model.

> **Relation to prior spec**: This spec refines and partially supersedes the Medium-related design decisions in `spirit-pulse-medium-domain-model.md`. The Spirit/Pulse/Medium conceptual model remains valid; this spec clarifies the **implementation architecture** for IM capabilities specifically, and establishes patterns for non-IM capabilities.

---

## Design Philosophy

The Athena Harness is **not** a generic bot framework, **not** a domain-agnostic agent runtime. It is a framework kernel for **anthropomorphic AI / digital life**.

For the IM domain specifically, we adopt a pragmatic principle:

> **Do not re-invent what a mature ecosystem already provides.**

Satori is a well-designed, community-supported IM protocol abstraction with 20+ platform adapters. Rather than wrapping it in a proprietary abstraction layer, we use Satori directly as the messaging capability. Developers learn Satori — a known, documented framework — not a bespoke `capability-messaging` interface.

---

## Core Decisions

### D-01: Satori IS the Messaging Implementation (revised)

Satori provides the protocol, types, and adapter ecosystem for IM messaging. It is not wrapped in a proprietary abstraction — its Methods signatures, data types (Message, Channel, User, Guild), and Element system are directly reused by `@athena-ai/capability-message`.

However, **Satori is not directly exposed to Cortex**. Instead, `ctx.message` (the MessageService from `capability-message`) installs Satori in an **internal isolation domain** (`ctx.isolate('satori').isolate('bots')`), so that `ctx.satori` and `ctx.bots` are invisible to the Life context. Cortex accesses bots and methods exclusively through `ctx.message`.

**Rationale**:
- Satori provides a complete, mature IM operation set (Methods: 40+ operations covering message, channel, guild, reaction, role, friend, upload)
- 20+ existing platform adapters (OneBot, Discord, Telegram, etc.) are directly reusable
- No proprietary protocol reinvention — capability-message re-exports Satori types
- Isolation ensures Cortex depends on the capability contract (`message`), not the implementation (`satori`)
- Cordis `isolate()` makes `ctx.satori`/`ctx.bots` invisible outside MessageService internals
- Events (`'message'`, `'message-created'`, etc.) still propagate to Life ctx because Satori Session has no `[Context.filter]` — event isolation is orthogonal to service isolation

**Implication**: Cortex code does `inject: ['message']` and calls `ctx.message.createMessage(...)` or accesses `ctx.message.bots`. It never sees `ctx.satori` directly.

**Supersedes**: The original D-01 which stated Cortex directly injects `satori`. Now Cortex injects `message` (the capability contract).

---

### D-02: One Nerve = One Bot Instance (revised naming)

In the conceptual model, a "Nerve" corresponds to a single Satori Bot instance — one platform connection with a specific `platform:selfId` identity.

**Rationale**:
- Satori Bot is already this granularity: one account on one platform
- Multi-Bot coordination belongs in Cortex (the integration layer), not within a single Nerve
- Two QQ accounts = two Bot instances, each an independent registration in `ctx.message`
- Clean lifecycle: Bot connect/disconnect = Nerve availability change

**Implication**: If a digital life connects to QQ and Discord simultaneously, those are two Bot instances registered in `ctx.message`, both available to Cortex for integration.


---

### D-03: Capabilities as Cordis Services with Isolation (revised)

Each capability category is a Cordis Service mounted on the Life context. Capabilities use internal isolation domains to encapsulate their implementation dependencies.

**Pattern**:
```
ctx.message      → messaging capability (MessageService, wraps Satori internally)
ctx.minecraft    → world capability (future, custom Service)
ctx.expression   → expression capability (future, custom Service)
ctx.audio        → audio capability (future, custom Service)
```

Cortex declares dependencies via Cordis `inject`:
```typescript
class CortexChat extends Service {
  static inject = ['message']  // requires messaging
}

class CortexWorld extends Service {
  static inject = ['message', 'minecraft']  // requires messaging + world
}
```

Cordis ensures Cortex only activates when all injected services are available. Service dispose propagates cleanly.

**Isolation model** (MessageService as reference implementation):
```typescript
class MessageService extends Service {
  static [Service.key] = 'message'
  private _ctx: Context  // internal isolation domain

  constructor(ctx: Context) {
    super(ctx, 'message')
    this._ctx = ctx.isolate('satori').isolate('bots')
    this._ctx.plugin(Satori)
  }

  get bots() { return this._ctx.satori.bots }
  async createMessage(channelId, content, botSid?) { ... }
}
```

**Key insight**: `ctx.isolate('satori')` creates a new symbol for the `satori` service key, making it invisible outside the isolation domain. But Cordis events (`'message'`, etc.) are NOT filtered by service isolation — they propagate normally to parent contexts.

**Rationale**:
- Leverages Cordis's proven dependency resolution and lifecycle management
- No custom `require()` mechanism needed
- Hot-install/removal of capabilities automatically affects Cortex activation
- Each capability domain is independently designed and maintained
- Isolation prevents Cortex from depending on implementation details

---

### D-04: Multi-Nerve Addressing via Event Source (revised naming)

When Cortex operates with multiple Bots (e.g., QQ + Discord), it addresses specific Bots using Satori's `bot.sid` from the event source.

**Mechanism**:
- Events carry source identity (= Satori Session's `platform:selfId` aka `bot.sid`)
- Cortex's enactment phase specifies target bot when calling `ctx.message.createMessage(...)`
- Single-Bot Cortex: addressing is optional (only one target, reduces LLM decision burden)
- Multi-Bot Cortex: must specify target via `ctx.message.bots[sid]`

**Satori native support**: `ctx.message.bots['onebot:12345']` provides direct Bot lookup by sid.

---

### D-05: Event Delivery is Push-based; Consumption Strategy is Cortex-internal (revised naming)

Events flow via Cordis event system (push). Cortex decides its own consumption strategy.

**Supersedes**: The prior spec's "pull-based sense queue" (FR-005 in `spirit-pulse-medium-domain-model.md`) is **rejected as a framework mechanism**.

**Rationale**:
- Cordis and Satori are natively push-based (`Bot.dispatch → ctx.emit`)
- All three Cortex types need some buffering, but with different strategies:
  - Chat: event → willingness calculation → trigger threshold → short aggregation window → execute
  - World: event → mailbox buffer → heartbeat drain → execute
  - Interlude: event → debounce buffer → threshold drain → execute
- Buffer strategy is deeply product-specific (window length, trigger conditions, aggregation logic)
- Framework imposing a queue abstraction would over-constrain Cortex design
- "Scheduling is Cortex-internal" (existing design principle) applies equally to event consumption

**Pattern**:
```typescript
// Chat Cortex (simplified)
ctx.on('message', (session) => {
  this.willingnessEngine.ingest(session)
  // when triggered: short aggregation window, then execute
})

// World Cortex
ctx.on('message', (session) => {
  this.mailbox.push(session)  // buffer
})
// In heartbeat loop: drain mailbox, integrate, execute

// Interlude Cortex
ctx.on('message', (session) => {
  this.debouncer.push(session)  // debounce buffer
})
// After debounce window: aggregate, execute
```

---

### D-06: Nerve Internal Interface = Satori Methods (revised naming)

The IM Nerve's internal API is Satori's `Methods` interface — the established IM operation set:

- Message: `createMessage`, `getMessage`, `getMessageList`, `editMessage`, `deleteMessage`
- Reaction: `createReaction`, `deleteReaction`, `clearReaction`, `getReactionList`
- Channel: `getChannel`, `getChannelList`, `createChannel`, `updateChannel`, `deleteChannel`
- Guild: `getGuild`, `getGuildList`, member/role CRUD
- User: `getLogin`, `getUser`, `getFriendList`
- Upload: `createUpload`

Each Bot instance implements a subset; `bot.features` auto-discovers which Methods are available. These methods are exposed through `ctx.message` (which delegates to the appropriate Bot).

**Rationale**:
- Mature, well-tested operation set covering the full IM domain
- Platform adapters only implement what their platform supports
- `features` mechanism provides runtime capability discovery without compile-time coupling

---

### D-07: Capability Token as Stable Identifier (revised)

Capability categories are identified by stable, well-known tokens (not arbitrary strings):

- `'message'` — messaging / IM interaction
- `'minecraft'` — 3D world interaction (future)
- `'expression'` — visual expression / Live2D (future)
- `'audio'` — voice/sound interaction (future)

These tokens correspond to Cordis Service provide keys. They form a stable enumeration that Cortex authors depend on.

**Extensibility**: Third-party developers can register new capabilities by defining their own Service with a unique provide key. The enumeration is open (new keys can be added) but each key, once established, is stable.

**Supersedes**: Original D-07 which used `'satori'` as the messaging token. Now `'message'` is the stable token; Satori is the implementation detail inside.

---

### D-08: Layer 3 (Nerve-provided Tools) Deferred (revised naming)

The mechanism by which Nerve/Bot instances provide platform-specific LLM tools (Layer 3 in the three-layer tool model) is **deferred for future design**.

Context from prior discussion:
- These are optional, platform-specific tools (like `onebot-utils`: ban, kick, set_essence, OCR)
- They are NOT raw API passthrough — they are carefully designed tools with schemas and descriptions
- They require permission/enablement control (`config.enabledTools`, scope filtering)
- Cortex does not understand their semantics but may control their visibility
- The pattern is proven in YesImBot v4 (`onebot-utils` as optional companion plugin)

This will be designed after the core capability and Cortex interaction patterns are stable.
---

## Revisiting "Nerve" in Practice

### Current Status

With the capability-message isolation design, the IM "Nerve" does not need a separate framework class. The Satori Bot instance (running inside `ctx.message`'s isolation domain) fulfills all Nerve responsibilities:

| Nerve Responsibility | Fulfilled By |
|---|---|
| Platform connection lifecycle | Satori Adapter (inside message isolation) |
| Unified operation interface | Satori Methods (exposed via `ctx.message`) |
| Event emission | Satori Bot.dispatch → Cordis events (propagate to Life ctx) |
| Multi-instance management | `ctx.message.bots` registry |
| Feature discovery | `bot.features` array |
| Content model | `@satorijs/element` |

### What "Nerve" Means in Practice

For IM: "Nerve" = a Satori Adapter plugin installed inside `ctx.message`'s isolation domain. Users install adapter plugins (nerve-satori with config pointing to Koishi bridge) and they auto-register Bots into `ctx.message`.

For non-IM scenarios (Minecraft, Live2D, Audio): Nerve = a plugin that registers connection instance(s) into the corresponding capability service (`ctx.minecraft`, `ctx.audio`, etc.), following the same pattern.

---

## Architectural Overview

```
┌─ Athena Runtime (Cordis Root Context) ─────────────────────────────────────┐
│                                                                             │
│  Life (identity: persona, memory, self-model)                               │
│    └── Cortex (survival strategy, inject declares capability dependencies)  │
│          │                                                                  │
│          ├── Subscribes to Cordis events (push-based, propagate from below) │
│          ├── Internal buffer/aggregation strategy                            │
│          ├── Calls methods via ctx.message.createMessage(...)               │
│          ├── Defines Layer 2 product-semantic tools for LLM                 │
│          └── Addresses Bot via ctx.message.bots[sid]                        │
│                                                                             │
│  ─── Capability Services (Life Context-level) ───                            │
│                                                                             │
│  ctx.message (MessageService)        = messaging capability                 │
│    ├── [isolation domain: ctx.satori hidden]                                │
│    ├── Bot: onebot:12345             = one Nerve instance                   │
│    │     └── Adapter: adapter-satori   (connects to Koishi bridge)          │
│    ├── Bot: discord:67890            = another Nerve instance               │
│    │     └── Adapter: adapter-satori   (connects to Koishi bridge)          │
│    └── Events: message, guild-*, reaction-*, login-* (propagate up)         │
│                                                                             │
│  ctx.minecraft (future)              = world capability                     │
│  ctx.expression (future)             = expression capability                │
│  ctx.audio (future)                  = audio capability                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User Scenarios & Testing

### User Story 1 — Cortex Developer Uses Messaging Capability (Priority: P1)

As a Cortex developer, I want to declare that my Cortex requires messaging capability by injecting `message`, then use Satori-derived Methods to send messages, read history, and manage reactions — without writing platform-specific code.

**Why this priority**: This is the fundamental developer experience. Cortex authors use `ctx.message` with familiar Satori Methods — no proprietary abstraction to learn.

**Independent Test**: Write a minimal Chat Cortex with `inject: ['message']`, install alongside a mock Satori Bot inside MessageService, verify the Cortex can call `createMessage`, `getMessageList`, and respond to events.

**Acceptance Scenarios**:

1. **Given** a Cortex declaring `inject: ['message']`, **When** installed in a Life context where MessageService is active with at least one Bot, **Then** Cortex activates and can invoke methods via `ctx.message`.
2. **Given** a Cortex calling `ctx.message.createMessage(channelId, content)`, **When** a Bot is connected, **Then** the message is dispatched to the platform via the Adapter.
3. **Given** a Cortex with `inject: ['message']`, **When** installed in a context with NO message service, **Then** Cordis prevents activation (unmet dependency).
4. **Given** a Cortex subscribing to `ctx.on('message', ...)`, **When** a platform message arrives, **Then** Cortex receives the event as a Satori Session with unified content (Element[]).

---

### User Story 2 — Nerve Developer Bridges a New IM Platform (Priority: P1)

As a Nerve developer, I want to add a new IM platform to the framework by writing a Satori Adapter — following Satori's established adapter pattern — so that all existing Cortices automatically gain access to this platform.

**Why this priority**: The value proposition of using Satori is adapter ecosystem reuse. If adding a platform requires anything beyond a standard Satori Adapter, we've lost the benefit.

**Independent Test**: Write a minimal Satori Adapter for a mock platform, install it inside `ctx.message`'s isolation domain, verify it registers a Bot with discoverable features and emits events through the Cordis event system.

**Acceptance Scenarios**:

1. **Given** a custom Adapter implementing Satori's `Adapter` abstract class, **When** installed inside MessageService's isolation domain, **Then** a Bot is registered in `ctx.message.bots` with appropriate `platform` and `features`.
2. **Given** the Adapter receiving a platform event, **When** it calls `bot.dispatch(session)`, **Then** the event propagates through Cordis to the Life context and is reachable by Cortex via `ctx.on('message', ...)`.
3. **Given** an existing Satori adapter (e.g., adapter-satori connecting to Koishi bridge), **When** installed in MessageService's isolation domain, **Then** it functions without modification.

---

### User Story 3 — End User Composes a Digital Life (Priority: P1)

As an end user (deployer), I want to compose a digital life by installing plugins — Life identity, Cortex, and messaging capability with Nerve(s) — with zero imperative wiring. Cordis plugin installation handles all dependency resolution.

**Why this priority**: Declarative composition is the framework's core promise.

**Independent Test**: Install Life + CortexChat + MessageService + adapter-satori as plugins in a Cordis context, verify the system self-assembles and responds to messages.

**Acceptance Scenarios**:

1. **Given** a Cordis root context, **When** user installs AliceLife + MessageService + adapter-satori + CortexChat, **Then** the system self-assembles: Alice responds to messages.
2. **Given** a running system, **When** user additionally installs another adapter, **Then** a new Bot appears in `ctx.message.bots`; Cortex can now interact with the new platform.
3. **Given** a running system, **When** an Adapter plugin is removed, **Then** its Bot is removed from `ctx.message.bots`; Cortex gracefully loses access to that platform.

---

### User Story 4 — Multi-Bot Cortex Addresses Specific Nerve (Priority: P2)

As a Cortex developer operating with multiple Bots, I want to address a specific Bot when dispatching actions, using the event source's `bot.sid` to route responses back to the originating platform.

**Why this priority**: Multi-platform operation is a key differentiator (one persona across QQ + Discord + Telegram), but depends on single-platform operation working first.

**Independent Test**: Install two mock Bots (different platforms), send an event from Bot A, verify Cortex can route the response back to Bot A specifically.

**Acceptance Scenarios**:

1. **Given** a Cortex receiving an event from Bot `onebot:12345`, **When** it dispatches a response via `ctx.message.bots['onebot:12345'].createMessage(...)`, **Then** the response goes to the originating platform.
2. **Given** a single-Bot setup, **When** Cortex dispatches without specifying a Bot, **Then** it succeeds (no disambiguation needed).
3. **Given** a multi-Bot setup, **When** Cortex needs to proactively message (not reply), **Then** it can enumerate `ctx.message.bots` and choose by platform/features.

---

### User Story 5 — Non-IM Capability Registration (Priority: P2)

As a capability developer, I want to define a new capability domain (e.g., Minecraft world interaction) as a Cordis Service, register it on the context, and have Cortex discover it via `inject` — using the same pattern as MessageService but with domain-specific methods.

**Why this priority**: The framework's ambition extends beyond IM. But IM is solved first; non-IM follows the established pattern.

**Independent Test**: Define a mock Minecraft Service with `inject: ['minecraft']` on a Cortex, verify Cordis lifecycle management works identically to messaging.

**Acceptance Scenarios**:

1. **Given** a Minecraft Service registered as `ctx.minecraft`, **When** a Cortex declares `inject: ['message', 'minecraft']`, **Then** Cortex activates only when both services are available.
2. **Given** a running Cortex using both message and minecraft, **When** Minecraft Service is disposed, **Then** Cortex is deactivated (dependency lost).
3. **Given** a custom capability Service, **When** it emits events via Cordis, **Then** Cortex can subscribe using the same `ctx.on(...)` pattern as message events.

---

### Edge Cases

- **Bot disconnects mid-operation** (WebSocket drop): Satori Adapter handles reconnection internally. Bot status changes to OFFLINE/RECONNECT. Cortex can observe `login-updated` events to react.
- **All Bots for a capability go offline**: MessageService remains available (service ≠ connectivity). Cortex attempts to send will receive errors from the Adapter. Cortex decides how to handle (retry, degrade, queue for later).
- **Multiple Bots on same platform** (two QQ accounts): Each is a separate Bot with distinct `sid`. Cortex addresses by `sid` via `ctx.message.bots[sid]`.
- **Adapter provides partial Methods** (e.g., no reaction support): `bot.features` array reflects available methods. Cortex can check before calling.
- **Hot-add Adapter at runtime**: New Bot appears in `ctx.message.bots`, emits `login-added`. Cortex can immediately use it if subscribed to login events.
---

## Requirements

### Functional Requirements (revised)

- **FR-001**: MessageService (`ctx.message`) MUST wrap Satori in an internal isolation domain, exposing Bot access and Methods through `ctx.message` only. `ctx.satori` and `ctx.bots` MUST NOT be visible to Life context or Cortex.
- **FR-002**: Existing Satori Adapters MUST function without modification when installed inside MessageService's isolation domain.
- **FR-003**: Each Bot instance MUST be independently addressable via `platform:selfId` (Satori's native `sid`) through `ctx.message.bots[sid]`.
- **FR-004**: Events from Satori Bots MUST propagate through Cordis event system to Life context (push-based). Satori Session's lack of `[Context.filter]` ensures events cross isolation boundaries.
- **FR-005**: Cortex MUST self-manage its event consumption strategy (buffering, aggregation, triggering). Framework provides no sense queue abstraction.
- **FR-006**: Non-IM capabilities MUST follow the same pattern: Cordis Service (with optional internal isolation) + Cortex `inject` dependency + Cordis events.
- **FR-007**: Capability tokens MUST be stable identifiers (`'message'`, `'minecraft'`, etc.). New tokens can be added; existing tokens are not renamed.
- **FR-008**: Cortex deactivation MUST occur automatically via Cordis when an injected capability Service is disposed.
- **FR-009**: Multi-Bot addressing MUST use `ctx.message.bots[sid]`. Single-Bot Cortex MUST NOT require explicit addressing.
- **FR-010**: Content model for messaging MUST use `@satorijs/element` (unified rich-text representation).

### Key Entities (revised naming)

- **MessageService** (`ctx.message`): The messaging capability contract. Wraps Satori in an isolation domain. Manages Bot access via `ctx.message.bots`. Delegates method calls to appropriate Bot. Provided by `@athena-ai/capability-message`.

- **Bot** (`ctx.message.bots[sid]`): A single platform connection instance (inside MessageService isolation). Implements a subset of Satori Methods. Holds platform, selfId, features, status. One Bot = one "Nerve" in the conceptual model.

- **Adapter**: Cordis plugin managing Bot connection lifecycle (connect, disconnect, reconnect). Platform-specific. Installed inside MessageService's isolation domain. One Adapter type may manage multiple Bot instances.

- **Capability Service** (general pattern): A Cordis Service providing a domain-specific operation interface. MessageService is the messaging instance of this pattern. Non-IM capabilities define their own Services.

- **Cortex**: Consumes capabilities via `inject`. Subscribes to Cordis events. Self-manages consumption strategy. Defines product-semantic tools (Layer 2) for LLM. Routes actions to specific Bots via `ctx.message.bots[sid]`.

---

## Success Criteria

### Measurable Outcomes (revised)

- **SC-001**: A Cortex developer can implement a complete survival strategy using `ctx.message` Methods without importing any platform-specific adapter package or accessing `ctx.satori` directly.
- **SC-002**: An existing Satori Adapter (e.g., `@satorijs/adapter-satori`) can be installed in MessageService's isolation domain and function without code changes.
- **SC-003**: A deployer can compose Life + Cortex + MessageService + Adapter(s) using only plugin installation — zero imperative wiring.
- **SC-004**: Three reference Cortices (Chat, World, Interlude) can operate using `ctx.message` as messaging capability, each with its distinct event consumption strategy.
- **SC-005**: Adding a new IM platform requires only implementing a Satori Adapter — no changes to Cortex code, Life, or framework internals.
- **SC-006**: A non-IM capability (e.g., mock Minecraft) can be added as a Cordis Service and consumed by Cortex using the same `inject` + event pattern.

---

## Assumptions (revised)

- Satori (`@satorijs/core` + `@satorijs/protocol` + `@satorijs/element`) is a stable dependency. Its API contract is relied upon.
- Cordis v4 Service provision, dependency injection (`inject`), `isolate()` mechanism, lifecycle (dispose propagation), and event system are used as-is.
- AI SDK v7 is the model-calling substrate (unchanged from prior specs).
- Initial implementation targets IM (Satori via MessageService) as the first and primary capability. Non-IM capabilities follow the same architectural pattern but are future work.
- The framework wraps Satori in a thin isolation layer (`ctx.message`) for encapsulation, but does NOT reinvent Satori's protocol or types — they are re-exported.
- Satori's push-based event model is accepted. Events propagate across isolation boundaries. Buffering/queuing is Cortex-internal.
- "Nerve" as a formal framework class is NOT required for IM. The concept is realized by Satori Adapter + Bot instances inside MessageService.

---

## Design Decisions & Rationale (revised summary)

### Decided

1. **Satori IS the messaging implementation (D-01, revised).** Satori provides protocol/types/adapters. `ctx.message` wraps it in an isolation domain. Cortex injects `message`, not `satori`. Rationale: reuse Satori's maturity without leaking implementation to consumers.

2. **One Nerve = One Bot instance (D-02, revised naming).** Multi-Bot coordination is Cortex's job. Rationale: matches Satori's native granularity; clean lifecycle boundary.

3. **Capabilities as Cordis Services with isolation (D-03, revised).** Each domain registers a Service with internal isolation for implementation deps. Cortex uses `inject` for dependency. Rationale: leverages Cordis DI + `isolate()` for clean encapsulation.

4. **Event source addressing via bot.sid (D-04, revised naming).** Optional for single-Bot; required for multi-Bot. Rationale: event already carries source identity; Cortex routes responses naturally.

5. **Push events, Cortex-internal consumption (D-05, revised naming).** Framework does not provide sense queue. Rationale: consumption strategy is deeply Cortex-specific; framework imposing a queue over-constrains.

6. **Satori Methods as Nerve interface (D-06, revised naming).** Cortex calls Methods via `ctx.message`. Rationale: proven API; `features` for partial implementation.

7. **Stable capability tokens (D-07, revised).** `'message'`, `'minecraft'`, etc. (not `'satori'`). Rationale: Cortex depends on abstract capability name, not implementation.

8. **Layer 3 deferred (D-08, revised naming).** Nerve-provided LLM tools designed later.

### Rejected / Superseded

9. **~~Pull-based sense queue as framework mechanism~~.** Rejected. Push-based via Cordis. Cortex self-manages buffering.

10. **~~Cortex directly injects `satori`~~.** Superseded by D-01 revision. Cortex injects `message` (the capability contract). Satori is hidden inside.

11. **~~Nerve as a separate framework class for IM~~.** Not needed. Satori Adapter + Bot inside MessageService fulfills Nerve responsibilities.

12. **~~Multiple Bots coordinated within one Nerve~~.** Rejected. One Bot = one Nerve instance. Multi-Bot integration is Cortex-level.

### Open for Future Resolution

- Layer 3 (Nerve-provided platform-specific LLM tools): mechanism, permission model, visibility control
- Non-IM capability interface design: Minecraft, Live2D, Audio — each needs its own Methods definition and capability package
- Multi-Life routing: how multiple Lives share messaging capability (future; v1 targets single-Life)
- Cordis official `@cordisjs/plugin-capability` integration: RBAC/permission system, may be used for Layer 3 tool permission control
- Unified event envelope: whether Cortex receives raw Satori Sessions or a thin normalized wrapper (currently: raw Satori Session is sufficient)

---

## Relationship to Prior Specs

### `spirit-pulse-medium-domain-model.md` (2026-08-18)

**Still valid** (with naming updated: Spirit→Life, Pulse→Cortex, Medium→Nerve):
- Three-primitive model: Life / Cortex / Nerve (conceptual)
- Life = persistent identity
- Cortex = complete survival strategy, non-switchable, Cortex-internal scheduling
- Agent is Cortex-internal
- Three-layer tool model (Layer 1 / Layer 2 / Layer 3 structure)
- No separate Harness Core layer
- Multiple Nerves are simultaneous
- Composition is Cordis-native (plugin installation)

**Refined by this spec**:
- Nerve for IM = Satori Adapter + Bot inside MessageService isolation
- "Structured capabilities" (Layer 1) for IM = Satori Methods via `ctx.message`
- Pull-based sense queue → rejected; push + Cortex-internal buffer
- Capability registration = Cordis Service provision with isolation (not custom registry)
- Cortex injects `message` capability token, not `satori` implementation

### `capability-protocol-and-entity-model.md` (2026-08-17)

**Fully superseded**. The evolution:
- Capability Protocol (abstract interface) → Medium (concrete entity) → Capability Service with isolation (final)
- The core insight remains: capabilities are discovered via Cordis DI, not string-ID wiring

### `naming-and-package-architecture.md` (2026-08-18)

**Extends this spec** with:
- Final naming: Life/Cortex/Nerve (D-20)
- Capability packages as contracts (D-27): `@athena-ai/capability-message`
- MessageService isolation design (D-27 implementation detail)
- Cordis events replace Sense Queue (D-28)
- Cortex contract = Service + inject (D-29)
- Nerve contract = capability contributor (D-30)
