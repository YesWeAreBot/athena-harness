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

### D-01: Satori IS the Messaging Capability

Satori is not "wrapped inside" a Medium or abstracted behind a `capability-messaging` service. The Satori Service (`ctx.satori`) is itself the messaging capability that Pulse depends on.

**Rationale**:
- Satori provides a complete, mature IM operation set (Methods: 40+ operations covering message, channel, guild, reaction, role, friend, upload)
- 20+ existing platform adapters (OneBot, Discord, Telegram, etc.) are directly reusable
- Adding a new IM platform = writing a Satori Adapter (established pattern)
- Avoids forcing developers to learn a proprietary abstraction when a well-known one exists
- A custom `capability-messaging` wrapper would be the unfamiliar concept; Satori itself is the standard

**Implication**: Pulse code that needs messaging does `inject: ['satori']` and calls Satori Methods directly (`ctx.satori.bots[sid].createMessage(...)`).

---

### D-02: One Medium = One Bot Instance

In the conceptual model, a "Medium" corresponds to a single Satori Bot instance — one platform connection with a specific `platform:selfId` identity.

**Rationale**:
- Satori Bot is already this granularity: one account on one platform
- Multi-Bot coordination belongs in Pulse (the integration layer), not within a single Medium
- Two QQ accounts = two Medium instances, each an independent Bot
- Clean lifecycle: Bot connect/disconnect = Medium availability change

**Implication**: If a digital life connects to QQ and Discord simultaneously, those are two Bot instances managed by Satori, both available to Pulse for integration.

---

### D-03: Capabilities as Cordis Services with Provider Registration

Each capability category is a Cordis Service mounted on the context. For IM, this is the existing Satori Service pattern. For non-IM capabilities (Minecraft, Live2D, Audio), each defines its own Service.

**Pattern**:
```
ctx.satori       → messaging capability (Satori Service, existing)
ctx.minecraft    → world capability (future, custom Service)
ctx.expression   → expression capability (future, custom Service)
ctx.audio        → audio capability (future, custom Service)
```

Pulse declares dependencies via Cordis `inject`:
```typescript
class ChatPulse {
  static inject = ['satori']  // requires messaging
}

class WorldPulse {
  static inject = ['satori', 'minecraft']  // requires messaging + world
}
```

Cordis ensures Pulse only activates when all injected services are available. Service dispose propagates cleanly.

**Rationale**:
- Leverages Cordis's proven dependency resolution and lifecycle management
- No custom `require()` mechanism needed
- Hot-install/removal of capabilities automatically affects Pulse activation
- Each capability domain is independently designed and maintained

---

### D-04: Multi-Medium Addressing via Event Source

When Pulse operates with multiple Bots (e.g., QQ + Discord), it addresses specific Bots using the `mediumId` from the event source.

**Mechanism**:
- Events carry `source.mediumId` (= Satori's `platform:selfId` aka `bot.sid`)
- Pulse's enactment phase passes `via: event.source.mediumId` to route responses back to the originating Bot
- Single-Bot Pulse: addressing is optional (only one target, reduces LLM decision burden)
- Multi-Bot Pulse: must specify target

**Satori native support**: `ctx.bots['onebot:12345']` already provides direct Bot lookup by sid.

---

### D-05: Event Delivery is Push-based; Consumption Strategy is Pulse-internal

Events flow via Cordis event system (push). Pulse decides its own consumption strategy.

**Supersedes**: The prior spec's "pull-based sense queue" (FR-005 in `spirit-pulse-medium-domain-model.md`) is **rejected as a framework mechanism**. 

**Rationale**:
- Cordis and Satori are natively push-based (`Bot.dispatch → ctx.emit`)
- All three Pulse types need some buffering, but with different strategies:
  - Chat: event → willingness calculation → trigger threshold → short aggregation window → execute
  - World: event → mailbox buffer → heartbeat drain → execute
  - Interlude: event → debounce buffer → threshold drain → execute
- Buffer strategy is deeply product-specific (window length, trigger conditions, aggregation logic)
- Framework imposing a queue abstraction would over-constrain Pulse design
- "Scheduling is Pulse-internal" (existing design principle) applies equally to event consumption

**Pattern**:
```typescript
// Chat Pulse (simplified)
ctx.on('message', (session) => {
  this.willingnessEngine.ingest(session)
  // when triggered: short aggregation window, then execute
})

// World Pulse
ctx.on('message', (session) => {
  this.mailbox.push(session)  // buffer
})
// In heartbeat loop: drain mailbox, integrate, execute

// Interlude Pulse
ctx.on('message', (session) => {
  this.debouncer.push(session)  // debounce buffer
})
// After debounce window: aggregate, execute
```

---

### D-06: Medium Internal Interface = Satori Methods

The IM Medium's internal API is Satori's `Methods` interface — the established IM operation set:

- Message: `createMessage`, `getMessage`, `getMessageList`, `editMessage`, `deleteMessage`
- Reaction: `createReaction`, `deleteReaction`, `clearReaction`, `getReactionList`
- Channel: `getChannel`, `getChannelList`, `createChannel`, `updateChannel`, `deleteChannel`
- Guild: `getGuild`, `getGuildList`, member/role CRUD
- User: `getLogin`, `getUser`, `getFriendList`
- Upload: `createUpload`

Each Bot instance implements a subset; `bot.features` auto-discovers which Methods are available.

**Rationale**:
- Mature, well-tested operation set covering the full IM domain
- Platform adapters only implement what their platform supports
- `features` mechanism provides runtime capability discovery without compile-time coupling

---

### D-07: Capability Token as Stable Identifier

Capability categories are identified by stable, well-known tokens (not arbitrary strings):

- `'satori'` — messaging / IM interaction
- `'minecraft'` — 3D world interaction (future)
- `'expression'` — visual expression / Live2D (future)
- `'audio'` — voice/sound interaction (future)

These tokens correspond to Cordis Service provide keys. They form a stable enumeration that Pulse authors depend on.

**Extensibility**: Third-party developers can register new capabilities by defining their own Service with a unique provide key. The enumeration is open (new keys can be added) but each key, once established, is stable.

---

### D-08: Layer 3 (Medium-provided Tools) Deferred

The mechanism by which Medium/Bot instances provide platform-specific LLM tools (Layer 3 in the three-layer tool model) is **deferred for future design**.

Context from prior discussion:
- These are optional, platform-specific tools (like `onebot-utils`: ban, kick, set_essence, OCR)
- They are NOT raw API passthrough — they are carefully designed tools with schemas and descriptions
- They require permission/enablement control (`config.enabledTools`, scope filtering)
- Pulse does not understand their semantics but may control their visibility
- The pattern is proven in YesImBot v4 (`onebot-utils` as optional companion plugin)

This will be designed after the core capability and Pulse interaction patterns are stable.

---

## Revisiting "Medium" as a Concept

### Current Status

With Satori serving directly as messaging capability, the "IM Medium" does not need a separate framework class. The Satori Bot instance fulfills all Medium responsibilities:

| Medium Responsibility | Fulfilled By |
|---|---|
| Platform connection lifecycle | Satori Adapter |
| Unified operation interface | Satori Methods |
| Event emission | Satori Bot.dispatch → Cordis events |
| Multi-instance management | Satori `ctx.bots` registry |
| Feature discovery | `bot.features` array |
| Content model | `@satorijs/element` |

### What "Medium" Still Means

"Medium" remains valid as a **conceptual term** describing "a contact surface between existence and world" — but for IM, it does not correspond to a dedicated class in the framework. It is realized by a Satori Bot instance.

For non-IM scenarios (Minecraft, Live2D, Audio), "Medium" may manifest as custom Services that follow a similar pattern:
- Service registration on ctx (capability availability)
- Provider instances (connection endpoints)
- Event emission via Cordis
- Method interface (domain-specific operations)

The naming and formal definition of "Medium" as a framework-level abstraction vs. purely conceptual label is **open for future resolution**.

---

## Architectural Overview

```
┌─ Athena Runtime (Cordis Root Context) ─────────────────────────────────────┐
│                                                                             │
│  Spirit (identity: persona, memory, self-model)                             │
│    └── Pulse (survival strategy, inject declares capability dependencies)   │
│          │                                                                  │
│          ├── Subscribes to Cordis events (push-based)                       │
│          ├── Internal buffer/aggregation strategy                            │
│          ├── Calls Satori Methods via ctx.satori.bots[sid]                  │
│          ├── Defines Layer 2 product-semantic tools for LLM                 │
│          └── Addresses Medium via event.source.mediumId                     │
│                                                                             │
│  ─── Capability Services (Context-level) ───                                │
│                                                                             │
│  ctx.satori (Satori Service)         = messaging capability                 │
│    ├── Bot: onebot:12345             = one Medium instance                  │
│    │     └── Adapter: OneBot WS        (connection management)              │
│    ├── Bot: discord:67890            = another Medium instance              │
│    │     └── Adapter: Discord WS       (connection management)              │
│    └── Events: message, guild-*, reaction-*, login-* ...                    │
│                                                                             │
│  ctx.minecraft (future)              = world capability                     │
│  ctx.expression (future)             = expression capability                │
│  ctx.audio (future)                  = audio capability                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## User Scenarios & Testing

### User Story 1 — Pulse Developer Uses Satori for IM (Priority: P1)

As a Pulse developer, I want to declare that my Pulse requires messaging capability by injecting Satori, then use Satori Methods to send messages, read history, and manage reactions — without writing platform-specific code or learning a proprietary abstraction.

**Why this priority**: This is the fundamental developer experience. If Pulse authors must learn a bespoke abstraction instead of using Satori directly, the architecture has failed.

**Independent Test**: Write a minimal Chat Pulse with `inject: ['satori']`, install alongside a mock Satori Bot, verify the Pulse can call `createMessage`, `getMessageList`, and respond to events.

**Acceptance Scenarios**:

1. **Given** a Pulse declaring `inject: ['satori']`, **When** installed in a context where Satori is active with at least one Bot, **Then** Pulse activates and can invoke Bot methods.
2. **Given** a Pulse calling `ctx.satori.bots[sid].createMessage(channelId, content)`, **When** the Bot is connected, **Then** the message is dispatched to the platform via the Adapter.
3. **Given** a Pulse with `inject: ['satori']`, **When** installed in a context with NO Satori service, **Then** Cordis prevents activation (unmet dependency).
4. **Given** a Pulse subscribing to `ctx.on('message', ...)`, **When** a platform message arrives, **Then** Pulse receives the event as a Satori Session with unified content (Element[]).

---

### User Story 2 — Adapter Developer Bridges a New IM Platform (Priority: P1)

As an adapter developer, I want to add a new IM platform to the framework by writing a Satori Adapter — following Satori's established adapter pattern — so that all existing Pulses automatically gain access to this platform.

**Why this priority**: The value proposition of using Satori is adapter ecosystem reuse. If adding a platform requires anything beyond a standard Satori Adapter, we've lost the benefit.

**Independent Test**: Write a minimal Satori Adapter for a mock platform, install it, verify it registers a Bot with discoverable features and emits events through the Cordis event system.

**Acceptance Scenarios**:

1. **Given** a custom Adapter implementing Satori's `Adapter` abstract class, **When** installed as a Cordis plugin, **Then** a Bot is registered in `ctx.bots` with appropriate `platform` and `features`.
2. **Given** the Adapter receiving a platform event, **When** it calls `bot.dispatch(session)`, **Then** the event is emitted through Cordis and reachable by Pulse via `ctx.on('message', ...)`.
3. **Given** an existing Satori adapter (e.g., adapter-onebot), **When** installed in Athena's Cordis context alongside Satori, **Then** it functions without modification.

---

### User Story 3 — End User Composes a Digital Life (Priority: P1)

As an end user (deployer), I want to compose a digital life by installing plugins — Spirit, Pulse, and one or more Satori Adapters — with zero imperative wiring. Cordis plugin installation handles all dependency resolution.

**Why this priority**: Declarative composition is the framework's core promise.

**Independent Test**: Install Spirit + ChatPulse + OneBotAdapter as plugins in a Cordis context, verify the system self-assembles and responds to messages.

**Acceptance Scenarios**:

1. **Given** a Cordis root context, **When** user installs Satori + OneBotAdapter + AliceSpirit + ChatPulse, **Then** the system self-assembles: Alice responds to messages via OneBot.
2. **Given** a running system, **When** user additionally installs a DiscordAdapter, **Then** a new Bot appears in `ctx.bots`; Pulse can now interact with Discord.
3. **Given** a running system, **When** an Adapter plugin is removed, **Then** its Bot is removed from `ctx.bots`; Pulse gracefully loses access to that platform.

---

### User Story 4 — Multi-Bot Pulse Addresses Specific Medium (Priority: P2)

As a Pulse developer operating with multiple Bots, I want to address a specific Bot when dispatching actions, using the event source's `mediumId` to route responses back to the originating platform.

**Why this priority**: Multi-platform operation is a key differentiator (one persona across QQ + Discord + Telegram), but depends on single-platform operation working first.

**Independent Test**: Install two mock Bots (different platforms), send an event from Bot A, verify Pulse can route the response back to Bot A specifically.

**Acceptance Scenarios**:

1. **Given** a Pulse receiving an event from Bot `onebot:12345`, **When** it dispatches a response via `ctx.satori.bots['onebot:12345'].createMessage(...)`, **Then** the response goes to the originating platform.
2. **Given** a single-Bot setup, **When** Pulse dispatches without specifying a Bot, **Then** it succeeds (no disambiguation needed).
3. **Given** a multi-Bot setup, **When** Pulse needs to proactively message (not reply), **Then** it can enumerate `ctx.bots` and choose by platform/features.

---

### User Story 5 — Non-IM Capability Registration (Priority: P2)

As a capability developer, I want to define a new capability domain (e.g., Minecraft world interaction) as a Cordis Service, register it on the context, and have Pulse discover it via `inject` — using the same pattern as Satori but with domain-specific methods.

**Why this priority**: The framework's ambition extends beyond IM. But IM is solved first; non-IM follows the established pattern.

**Independent Test**: Define a mock Minecraft Service with `inject: ['minecraft']` on a Pulse, verify Cordis lifecycle management works identically to Satori.

**Acceptance Scenarios**:

1. **Given** a Minecraft Service registered as `ctx.minecraft`, **When** a Pulse declares `inject: ['satori', 'minecraft']`, **Then** Pulse activates only when both services are available.
2. **Given** a running Pulse using both Satori and Minecraft, **When** Minecraft Service is disposed, **Then** Pulse is deactivated (dependency lost).
3. **Given** a custom capability Service, **When** it emits events via Cordis, **Then** Pulse can subscribe using the same `ctx.on(...)` pattern as Satori events.

---

### Edge Cases

- **Bot disconnects mid-operation** (WebSocket drop): Satori Adapter handles reconnection internally. Bot status changes to OFFLINE/RECONNECT. Pulse can observe `login-updated` events to react.
- **All Bots for a capability go offline**: Satori service remains available (service ≠ connectivity). Pulse attempts to send will receive errors from the Adapter. Pulse decides how to handle (retry, degrade, queue for later).
- **Multiple Bots on same platform** (two QQ accounts): Each is a separate Bot with distinct `sid`. Pulse addresses by `sid`.
- **Adapter provides partial Methods** (e.g., no reaction support): `bot.features` array reflects available methods. Pulse can check before calling.
- **Hot-add Adapter at runtime**: New Bot appears in `ctx.bots`, emits `login-added`. Pulse can immediately use it if subscribed to login events.

---

## Requirements

### Functional Requirements

- **FR-001**: Satori Service MUST be directly usable as the messaging capability — Pulse accesses it via `inject: ['satori']` and calls Satori Methods on Bot instances.
- **FR-002**: Existing Satori Adapters (adapter-onebot, adapter-discord, etc.) MUST function without modification when installed in Athena's Cordis context.
- **FR-003**: Each Bot instance MUST be independently addressable via `platform:selfId` (Satori's native `sid`).
- **FR-004**: Events from Satori Bots MUST flow through Cordis event system (push-based). Framework MUST NOT impose a pull-based queue mechanism.
- **FR-005**: Pulse MUST self-manage its event consumption strategy (buffering, aggregation, triggering). Framework provides no sense queue abstraction.
- **FR-006**: Non-IM capabilities MUST follow the same pattern: Cordis Service + `inject` dependency + Cordis events. Each capability defines its own domain-specific Methods.
- **FR-007**: Capability tokens MUST be stable identifiers (Cordis Service provide keys). New tokens can be added; existing tokens are not renamed.
- **FR-008**: Pulse deactivation MUST occur automatically via Cordis when an injected capability Service is disposed.
- **FR-009**: Multi-Bot addressing MUST use event source's `mediumId` (= Bot `sid`). Single-Bot Pulse MUST NOT require explicit addressing.
- **FR-010**: Content model for messaging MUST use `@satorijs/element` (unified rich-text representation).

### Key Entities

- **Satori Service** (`ctx.satori`): The messaging capability. Manages Bot instances, internal routing, session sequencing. Provided by `@satorijs/core`.

- **Bot** (`ctx.bots[sid]`): A single platform connection instance. Implements a subset of Satori Methods. Holds platform, selfId, features, status. One Bot = one "IM Medium" in the conceptual model.

- **Adapter**: Cordis plugin managing Bot connection lifecycle (connect, disconnect, reconnect). Platform-specific. One Adapter type may manage multiple Bot instances (via `fork`).

- **Capability Service** (general pattern): A Cordis Service providing a domain-specific operation interface. Satori is the messaging instance of this pattern. Non-IM capabilities define their own Services.

- **Pulse**: Consumes capabilities via `inject`. Subscribes to Cordis events. Self-manages consumption strategy. Defines product-semantic tools (Layer 2) for LLM. Routes actions to specific Bots via `sid`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A Pulse developer can implement a complete survival strategy using Satori Methods without importing any platform-specific adapter package.
- **SC-002**: An existing Satori Adapter (e.g., `@satorijs/adapter-onebot`) can be installed in Athena's context and function without code changes.
- **SC-003**: A deployer can compose Spirit + Pulse + Adapter(s) using only plugin installation — zero imperative wiring.
- **SC-004**: Three reference Pulses (Chat, World, Interlude) can operate using Satori as messaging capability, each with its distinct event consumption strategy.
- **SC-005**: Adding a new IM platform requires only implementing a Satori Adapter — no changes to Pulse code, Spirit, or framework internals.
- **SC-006**: A non-IM capability (e.g., mock Minecraft) can be added as a Cordis Service and consumed by Pulse using the same `inject` + event pattern.

---

## Assumptions

- Satori (`@satorijs/core` + `@satorijs/protocol` + `@satorijs/element`) is a stable dependency. Its API contract is relied upon.
- Cordis v4 Service provision, dependency injection (`inject`), lifecycle (dispose propagation), and event system are used as-is.
- AI SDK v7 is the model-calling substrate (unchanged from prior specs).
- Initial implementation targets IM (Satori) as the first and primary capability. Non-IM capabilities follow the same architectural pattern but are future work.
- The framework does NOT wrap Satori in a proprietary abstraction. Pulse developers interact with Satori's documented API directly.
- Satori's push-based event model is accepted. Buffering/queuing is Pulse-internal.
- "Medium" as a formal framework class is NOT required for IM. The concept may materialize for non-IM capabilities if needed.
- The prior spec's Spirit and Pulse concepts remain valid; only the Medium/capability implementation changes.

---

## Design Decisions & Rationale

### Decided

1. **Satori IS the messaging capability (D-01).** No wrapping layer. Pulse injects Satori directly. Rationale: Satori is mature, documented, has ecosystem; a proprietary wrapper would be the unfamiliar concept.

2. **One Medium = One Bot instance (D-02).** Multi-Bot coordination is Pulse's job. Rationale: matches Satori's native granularity (`platform:selfId`); clean lifecycle boundary.

3. **Capabilities as Cordis Services (D-03).** Each domain registers a Service; Pulse uses `inject` for dependency. Rationale: leverages Cordis's proven DI and lifecycle; no custom capability registry.

4. **Event source addressing (D-04).** `mediumId` = Bot `sid`; optional for single-Bot. Rationale: event already carries source identity; Pulse routes responses naturally.

5. **Push events, Pulse-internal consumption (D-05).** Framework does not provide sense queue. Rationale: consumption strategy (immediate, buffered, debounced) is deeply Pulse-specific; all patterns need some aggregation window; framework imposing a queue over-constrains.

6. **Satori Methods as IM interface (D-06).** Pulse calls createMessage, getMessageList, etc. directly. Rationale: proven API design; `features` mechanism for partial implementation; no LCD re-abstraction needed.

7. **Stable capability tokens (D-07).** `'satori'`, `'minecraft'`, etc. as Service provide keys. Rationale: Pulse declares dependencies by stable name; extensible by adding new keys.

8. **Layer 3 deferred (D-08).** Platform-specific LLM tool mechanism designed later. Rationale: core capability interaction must be stable first; Layer 3 pattern is proven in YesImBot v4 and can be added incrementally.

### Rejected / Superseded

9. **~~Pull-based sense queue as framework mechanism~~.** Rejected. Events are push-based via Cordis. Pulse self-manages buffering. Rationale: over-constrains Pulse design; Chat Pulse also has aggregation needs that don't fit a simple "drain queue" model.

10. **~~capability-messaging as wrapper around Satori~~.** Rejected. Satori is exposed directly. Rationale: the wrapper would be the unfamiliar concept; developers would still need to understand Satori underneath; zero abstraction benefit.

11. **~~Medium as a framework class for IM~~.** Not needed. Satori Bot + Adapter already fulfill all Medium responsibilities. "Medium" remains a conceptual term. Rationale: adding a Medium class between Pulse and Satori adds indirection without value for the IM domain.

12. **~~Multiple Bots coordinated within one Medium~~.** Rejected. One Medium = one Bot. Multi-Bot integration is Pulse-level. Rationale: simpler lifecycle; matches Satori's `platform:selfId` atom; Pulse owns cross-platform integration strategy.

### Open for Future Resolution

- Layer 3 (Medium-provided platform-specific LLM tools): mechanism, permission model, visibility control
- Non-IM capability interface design: Minecraft, Live2D, Audio — each needs its own Methods definition
- "Medium" naming and formalization: whether non-IM capabilities need a shared base class/interface, or each is fully independent
- Multi-Spirit routing: how multiple Spirits share Satori Bots (future; v1 targets single-Spirit)
- Cordis official `@cordisjs/plugin-capability` integration: this is an RBAC/permission system, NOT our capability-as-interface concept; may be used for Layer 3 tool permission control in the future
- Unified event envelope: whether Pulse receives raw Satori Sessions or a thin normalized wrapper (currently: raw Satori Session is sufficient)

---

## Relationship to Prior Specs

### `spirit-pulse-medium-domain-model.md` (2026-08-18)

**Still valid**:
- Three-primitive model: Spirit / Pulse / Medium (conceptual)
- Spirit = persistent identity
- Pulse = complete survival strategy, non-switchable, Pulse-internal scheduling
- Agent is Pulse-internal
- Three-layer tool model (Layer 1 / Layer 2 / Layer 3 structure)
- No separate Harness Core layer
- Multiple Media are simultaneous
- Composition is Cordis-native (plugin installation)

**Refined by this spec**:
- Medium for IM = Satori Bot (no separate class)
- "Structured capabilities" (Layer 1) for IM = Satori Methods directly
- Pull-based sense queue → rejected; push + Pulse-internal buffer
- Capability registration = Cordis Service provision (not custom registry)

### `capability-protocol-and-entity-model.md` (2026-08-17)

**Superseded** by `spirit-pulse-medium-domain-model.md`, which is further refined by this spec. The evolution:
- Capability Protocol (abstract interface) → Medium (concrete entity) → Satori-as-capability (use existing implementation)
- The core insight remains: capabilities are discovered via Cordis DI, not string-ID wiring
