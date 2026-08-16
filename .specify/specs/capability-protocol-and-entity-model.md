# Feature Specification: Capability Protocol & Core Entity Model

**Feature Branch**: `capability-protocol-entity-model`

**Created**: 2026-08-17

**Status**: Draft

**Input**: User description: "Domain modeling session for Athena Harness framework. Establish core entity model (Life, Mode, Agent, Capability Protocol, Adapter) replacing the previous Body-based design. Define how a digital life discovers, inhabits, and acts through abstract capability interfaces — platform-agnostic, supporting IM, 3D worlds, expression systems, and physical embodiments."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Adapter Developer Provides IM Capability (Priority: P1)

As an adapter developer, I want to write a plugin that bridges a concrete chat platform (e.g., OneBot/Satori/Discord) to the framework by declaring "I provide IM capability," so that any Mode requiring IM can use my adapter without knowing its internals.

The adapter declares which capability protocols it implements. It provides both sensing (incoming messages, events) and acting (send message, react, etc.) through the abstract IM protocol interface. The adapter handles all platform-specific details (connection, authentication, message format conversion) internally.

**Why this priority**: Without adapters providing capabilities, nothing else in the system can function. This is the foundation of the platform-agnostic design.

**Independent Test**: Can be fully tested by installing a mock IM adapter plugin, verifying it registers its capabilities into the Cordis context, and confirming its sense/act methods are discoverable by consumers.

**Acceptance Scenarios**:

1. **Given** a Cordis context with the Athena Runtime loaded, **When** an adapter plugin is installed that implements the IM capability protocol, **Then** the capability is discoverable via the context's capability mechanism (not string-ID lookup).
2. **Given** an installed IM adapter, **When** a consumer calls `act` on the IM capability (e.g., send a message), **Then** the adapter translates and dispatches the action to the concrete platform.
3. **Given** an installed IM adapter receiving a platform event, **When** the event matches a defined IM sense (e.g., message-received), **Then** the event is available as a subscribable percept source, not immediately pushed to all consumers.
4. **Given** two adapters providing the same capability protocol (e.g., OneBot IM + Discord IM), **When** a consumer queries for IM capabilities, **Then** both are discoverable and distinguishable (by metadata, not magic string IDs).

---

### User Story 2 - Mode Developer Consumes Capabilities Platform-Agnostically (Priority: P1)

As a Mode developer, I want to declare that my Mode requires certain capability protocols (e.g., "IM") and optionally others (e.g., "3D-World"), then act through those abstract interfaces without knowing whether the underlying platform is OneBot, Discord, Minecraft, or a physical robot.

Mode receives events from capability sources by subscribing at its own rhythm (pull-based). Mode sends actions through capability protocol methods. Mode does not import adapter-specific packages for basic operation.

**Why this priority**: Mode is the heavy orchestration unit. If Mode authors must wire to specific adapters by ID, the platform-agnostic design fails. This is equally critical as Story 1.

**Independent Test**: Can be fully tested by writing a Mode that declares `requires: ["im"]`, installing it alongside a mock IM adapter, and verifying the Mode can subscribe to events and invoke actions without referencing any adapter-specific identifier.

**Acceptance Scenarios**:

1. **Given** a Mode declaring `requires: [IMCapability]`, **When** the Mode is activated in a context where an IM adapter is installed, **Then** the Mode can obtain a handle to the IM capability and invoke its act methods.
2. **Given** a Mode declaring `requires: [IMCapability]`, **When** activated in a context with NO IM adapter, **Then** activation fails with a clear error (missing required capability).
3. **Given** a Mode subscribing to IM events, **When** multiple events arrive in rapid succession, **Then** the Mode's inbox serializes delivery — no concurrent `handle()` invocations unless Mode explicitly opts into parallelism.
4. **Given** a Mode that needs both IM and 3D-World, **When** only IM is available, **Then** the Mode can declare 3D-World as optional and gracefully degrade (operate without it).
5. **Given** a Chat Mode and a World Mode, **When** each subscribes to the same IM capability source, **Then** each receives events independently at its own drain rhythm (Chat: immediate, World: buffered into mailbox).

---

### User Story 3 - End User Composes a Digital Life (Priority: P1)

As an end user (deployer), I want to compose a digital life by installing plugins in a Cordis context — choosing a Life (identity/persona), a Mode (behavioral strategy), and one or more Adapters (platform connections) — without writing imperative wiring code or knowing internal IDs.

Composition is declarative: install plugins in the right scope, and they discover each other through the service/capability graph. No `life.attachBody("onebot")`. No manual ID assignment.

**Why this priority**: This is the Cordis-native composition promise. If end-user wiring is imperative, we've failed the framework's core value proposition.

**Independent Test**: Can be fully tested by writing a minimal deployment script that installs Life + Mode + Adapter plugins into a context tree, starts the context, and verifies the Life responds to adapter events through the Mode — with zero explicit wiring beyond plugin installation.

**Acceptance Scenarios**:

1. **Given** a fresh Cordis root context, **When** user installs `AthenaRuntime`, `AlicePersona`, `ChatMode`, and `OneBotAdapter` as plugins, **Then** the system self-assembles: Alice starts operating in Chat mode via OneBot, with no additional wiring code.
2. **Given** a running Life with ChatMode and OneBotAdapter, **When** user additionally installs `MinecraftAdapter`, **Then** the new capability becomes available to the Mode (if Mode supports optional 3D-World) without restarting.
3. **Given** two Life plugins installed (Alice and Bob) in the same context tree, **When** both require IM and one OneBotAdapter is available, **Then** clear semantics determine routing (either shared with multiplexing rules, or error requiring separate adapter instances per life, or scoped installation).
4. **Given** a Life is disposed (plugin removed), **When** teardown occurs, **Then** all subscriptions to capability sources are automatically cleaned up via Cordis fiber lifecycle — no manual unsubscribe.

---

### User Story 4 - Mode Controls Perception Mediation (Priority: P2)

As a World Mode developer, I want to mediate perception — raw IM events don't directly reach the Agent; instead, they enter a "phone" simulation where the Bot must choose to pick up the phone to see messages. The Mode gates and transforms raw capability events before they become Agent input.

This means the Mode sits between the capability source and the Agent's context. Mode subscribes to the raw capability event source, applies its own mediation logic (buffering, gating, narrative framing), and only feeds processed stimuli to the Agent when appropriate.

**Why this priority**: This is what distinguishes the three products. Without mediation, World and Interlude collapse into Chat. But it's P2 because the mechanism depends on P1 (capability discovery and subscription) being solved first.

**Independent Test**: Can be tested by writing a World Mode that subscribes to IM events but buffers them into a mailbox. Verify that when 5 messages arrive, the Agent doesn't see them until the Mode's internal scheduler triggers a "check phone" cycle.

**Acceptance Scenarios**:

1. **Given** a World Mode subscribing to IM capability events, **When** 3 messages arrive while the Bot is "resting," **Then** the messages accumulate in the Mode's mailbox but do NOT trigger Agent execution.
2. **Given** a World Mode in "phone-up" state, **When** the Mode's scheduler triggers a drain, **Then** the accumulated messages are transformed into Agent-facing percepts ("you see 3 new messages in the group chat") and fed to the Agent.
3. **Given** an Interlude Mode, **When** a message arrives, **Then** it enters a debounce buffer; the narrative turn fires only after the debounce window expires with no new messages.
4. **Given** a Chat Mode, **When** a message arrives, **Then** it is immediately dispatched to the Agent as a percept (degenerate case: no mediation, drain immediately).

---

### User Story 5 - Capability Protocol Extensibility (Priority: P2)

As a framework extender, I want to define new capability protocols (e.g., "Audio", "Vision", "Haptic") beyond the built-in set, write adapters that implement them, and write Modes that consume them — all using the same mechanism as built-in protocols.

The protocol definition mechanism is open. A protocol is: a unique identifier, a sense contract (event types), an act contract (available actions), and optional state (observable properties).

**Why this priority**: The framework's ambition is digital life, not just chat bots. Extensibility to new media (VR, robotics, audio/video) is a core differentiator. But built-in protocols come first.

**Independent Test**: Can be tested by defining a custom "Audio" protocol with sense (incoming-audio-stream) and act (play-audio, speak), writing a mock adapter implementing it, and verifying a Mode can discover and use it identically to built-in protocols.

**Acceptance Scenarios**:

1. **Given** a user-defined capability protocol "Audio" with `sense: [audio-stream-received]` and `act: [speak, play]`, **When** an adapter registers as providing this protocol, **Then** it is discoverable through the same mechanism as built-in IM/3DWorld protocols.
2. **Given** a Mode declaring `optional: [AudioCapability]`, **When** an Audio adapter is present, **Then** Mode can subscribe to audio events and invoke audio actions.
3. **Given** a protocol definition, **When** an adapter claims to implement it but doesn't provide all required act methods, **Then** registration fails with a clear validation error.

---

### User Story 6 - Multiple Lives, Shared Platform (Priority: P3)

As a deployer running multiple AI personas, I want two or more Lives to share a single platform adapter (e.g., two personas in the same QQ group), with clear routing semantics for who perceives what and how responses are attributed.

**Why this priority**: This is a future capability. The immediate need is one Life per deployment. But the design must not preclude multi-Life scenarios.

**Independent Test**: Can be tested by installing two Life plugins and one IM adapter, sending a message, and verifying both Lives receive the event (broadcast) or that routing rules determine delivery.

**Acceptance Scenarios**:

1. **Given** two Lives (Alice, Bob) both subscribing to the same IM capability source, **When** a message arrives, **Then** both receive the event independently (each in their own serialized inbox).
2. **Given** two Lives sharing an IM adapter, **When** Alice's Mode calls `im.send(channel, message)`, **Then** the message is attributed to the adapter's account (the Lives share the "body" — same account, potentially different response styles).
3. **Given** a deployment wanting isolated routing (Alice handles channel A, Bob handles channel B), **When** configuring subscriptions, **Then** each Life can filter at the subscription boundary (subscribe only to events matching certain channels).

---

### User Story 7 - Life Persistence and Mode Switching (Priority: P3)

As a deployer, I want a Life to persist across restarts (identity, memory, persona survive) and to switch Modes at runtime (e.g., from Chat to World) without losing identity continuity.

**Why this priority**: Mode switching is the long-term vision (one Life can operate in different paradigms). But initial deployment will likely be one Mode per Life. Design must not preclude switching.

**Independent Test**: Can be tested by starting a Life in Chat Mode, switching to World Mode, and verifying identity/memory state carries over while the operational strategy completely changes.

**Acceptance Scenarios**:

1. **Given** a Life running in Chat Mode, **When** a mode-switch is triggered, **Then** Chat Mode is cleanly disposed (fiber teardown), World Mode is activated, and the Life's identity/memory remain intact.
2. **Given** a Life that has been running for days, **When** the process restarts, **Then** Life state (persona, memory) is restored from persistence, and the Mode resumes (or restarts cleanly).
3. **Given** a mode switch from Chat to World, **When** World Mode requires capabilities not available (e.g., no 3D-World adapter), **Then** the switch fails with a clear error and the Life remains in Chat Mode.

---

### Edge Cases

- What happens when an adapter disconnects mid-operation? (e.g., WebSocket drops) → Capability source should signal disconnection; Mode decides how to handle (retry via adapter, degrade, error).
- What happens when a Mode requires a capability that becomes unavailable after activation? (e.g., adapter plugin uninstalled) → Cordis fiber teardown propagates; Mode receives a capability-lost event or its subscription errors.
- How does the system handle adapter reconnection? → Adapter-internal concern. The capability source resumes emitting events when reconnected. Mode's inbox accumulates or is notified of the gap.
- What if two Modes on the same Life try to act on the same capability simultaneously? → Only one Mode is active per Life at a time (enforced by framework). Mode switching is atomic.
- What if an adapter provides a partial implementation of a protocol? (e.g., IM without reaction support) → Protocol can define required vs optional methods. Adapter declares which optional features it supports. Mode can query feature support.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST provide a mechanism to define Capability Protocols as abstract interfaces with sense (event types), act (action methods), and optional state (observable properties).
- **FR-002**: Adapters MUST register as providers of specific capability protocols via Cordis-native mechanisms (service provision, not string-ID registries).
- **FR-003**: Modes MUST declare required and optional capabilities, and the framework MUST validate availability at Mode activation time.
- **FR-004**: Capability event delivery MUST be pull-based (subscribable source with Mode-owned inbox), not push-based broadcast. Mode controls drain rhythm.
- **FR-005**: Event delivery to a Mode's inbox MUST be serialized by default — no concurrent `handle()` calls unless Mode explicitly opts into parallel processing.
- **FR-006**: Mode MUST act through abstract capability protocol methods, not through adapter-specific identifiers or APIs.
- **FR-007**: Multiple adapters providing the same capability protocol MUST be distinguishable and independently subscribable (by metadata, not magic strings).
- **FR-008**: Life MUST be a persistent identity entity holding persona, long-term memory, and active Mode reference — surviving process restarts via persistence.
- **FR-009**: Agent MUST be a lightweight, Mode-internal entity (configured model-calling context: model + prompt + tools + optional session state). Framework provides creation infrastructure but does not own Agent lifecycle at the Life level.
- **FR-010**: Scheduling and trigger logic MUST be Mode-internal. Framework provides timer/scheduling primitives; strategy belongs to Mode.
- **FR-011**: Session Log MUST be treated as one context-assembly strategy (append-only timeline for Chat), not as a universal substrate. Modes that reconstruct context from domain state (World, Interlude) are equally valid.
- **FR-012**: Composition MUST be Cordis-native: plugin installation in the appropriate scope automatically establishes capability availability — no imperative wiring calls.
- **FR-013**: System MUST support hot-addition of adapters (install adapter plugin at runtime → capability becomes available to active Mode if Mode supports dynamic capability discovery).
- **FR-014**: Per-Life cleanup MUST be automatic via Cordis fiber lifecycle — disposing a Life's context disposes all subscriptions, Mode, and associated resources.
- **FR-015**: Framework MUST ship a small set of built-in capability protocols (IM at minimum) while providing an open extension mechanism for user-defined protocols.
- **FR-016**: Capability protocols MUST support feature negotiation — adapters can declare which optional features of a protocol they support, and Modes can query this.

### Key Entities

- **Life**: Persistent identity. Owns persona (stable character definition), long-term memory (accumulated knowledge/experience), and holds reference to one active Mode. Exists within a Cordis context scope. Cardinality: one Life per identity; one Life can interact with multiple channels/conversations through its Mode.

- **Mode**: Heavy, replaceable orchestration strategy. Determines how a Life operates: trigger handling, context assembly, model calling, result interpretation, state mutation, continuation/scheduling. Mode creates and manages Agents internally. Mode subscribes to capability sources and acts through capability protocols. Mode is the product-logic layer (Chat Mode ≈ hundreds of lines, World Mode ≈ 1000+, Interlude Mode ≈ 3000+).

- **Agent**: Lightweight model-calling context, internal to Mode. Holds: model configuration, prompt, tool set, optional session/context state. Mode creates/destroys Agents as needed (Chat: one per conversation, World: two — Bot + World, Interlude: one — Narrator). Not a top-level framework entity.

- **Capability Protocol**: Abstract interface definition for a medium of interaction. Defines: sense contract (subscribable event types), act contract (available action methods), optional state contract (observable properties), optional feature flags. Examples: IM, 3DWorld, Expression, PhysicalMotion, Audio, Vision. Framework-defined or user-extensible.

- **Adapter**: Cordis plugin that implements one or more Capability Protocols. Bridges a concrete platform (OneBot, Satori, Discord, Minecraft, Live2D, physical hardware) to abstract protocol interfaces. Handles: connection management, authentication, format conversion, reconnection. Declares which protocols and which optional features it supports.

- **Capability Source** (sub-entity of Adapter): A subscribable event stream for a specific sense defined by a protocol. Consumers (Modes) subscribe with optional filters. Subscription is the connection mechanism — no attach/detach by ID.

- **Inbox** (sub-entity of Mode): A serialized, pull-able buffer that Mode uses to drain capability events at its chosen rhythm. Guarantees serialization. Mode can implement: immediate drain (Chat), buffered drain (World mailbox), debounced drain (Interlude).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A Mode developer can write a complete Mode consuming IM capability without importing any adapter-specific package or referencing any platform-specific identifier.
- **SC-002**: An adapter developer can bridge a new platform by implementing a capability protocol interface and installing a plugin — with zero changes to existing Modes or Life configurations.
- **SC-003**: An end user can compose a working digital life (Life + Mode + Adapter) using only plugin installation — zero imperative wiring calls, zero string-ID knowledge.
- **SC-004**: Three reference Modes (Chat, World, Interlude) can be implemented on this framework, each demonstrating its unique orchestration pattern (finite loop, continuous mailbox, structured-output narrative), all sharing the same adapter infrastructure.
- **SC-005**: Concurrent event delivery does NOT cause session invariant violations — verified by test firing rapid percepts at a finite-tool-loop Mode.
- **SC-006**: Hot-adding an adapter to a running context makes the new capability available without restart.
- **SC-007**: Disposing a Life plugin automatically cleans up all subscriptions and Mode state — verified by checking no dangling listeners after disposal.

## Assumptions

- Cordis v4 is the composition substrate. Its Context inheritance, Service provision, Fiber lifecycle, events, and isolate mechanisms are available and stable.
- AI SDK v7 is the model-calling substrate. It provides generateText, streamText, tool mechanics, and structured output.
- The framework does NOT attempt to be a general-purpose agent execution layer (no "Harness Core" generic abstraction). It is specifically designed for anthropomorphic AI / digital life agents.
- Initial implementation targets IM capability as the first built-in protocol. 3DWorld, Expression, etc. follow later.
- Mode switching is a design-time concern (the design must not preclude it) but not an implementation-time concern for v1.
- Multi-Life scenarios (multiple Lives sharing adapters) are a future capability; the design must not preclude them but v1 targets single-Life deployment.
- The existing `athena-runtime` Body/BodyAdapter/BodyRegistry implementation is superseded by this design. Migration will be needed.
- "Session Log" as append-only timeline continues to serve Chat Mode well; other Modes use their own context-assembly strategies. The framework does not mandate one approach.
- The framework provides no "World" entity. Any world simulation (YesImBotWorld's virtual world, Interlude's story database) is Mode-internal state.

## Design Decisions & Rationale (from discussion)

### Decided

1. **No separate Harness Core layer.** The substrate is Cordis + AI SDK. Athena Runtime IS the framework. Rationale: extracting a generic "agent execution environment" layer provides insufficient value above what Cordis + AI SDK already offer.

2. **Agent is Mode-internal.** Not a top-level framework entity. Rationale: the three products use "agents" in radically different ways (continuous loop, stateless function call, single structured-output call). Unifying them as a framework entity forces false commonality.

3. **Mode is the whole replaceable unit.** Not decomposed into independent axes. The "six axis" analysis (trigger, context assembly, execution shape, result interpretation, state mutation, continuation) was useful for understanding but the axes co-vary in practice (execution shape ↔ result interpretation, trigger ↔ continuation, context assembly ↔ state mutation). Mode is a specific combination — the whole Agent Loop/turn-executor, not a composition of independent slots.

4. **Scheduling is Mode-internal.** Framework provides primitives; strategy is Mode's business. Rationale: scheduling logic is deeply intertwined with product state (Interlude's debounce knows participant buffers; World's tingle knows the clock).

5. **No "World" framework entity.** World simulation / narrative database / platform state is Mode-internal. Rationale: the three products' "worlds" are radically different (LLM-maintained simulation vs. structured narrative DB vs. platform state) with no meaningful shared abstraction.

6. **Body entity with string-ID wiring is rejected.** Replaced by Capability Protocol + Adapter + subscribable sources. Rationale: ID-based wiring is anti-Cordis (imperative, requires out-of-band knowledge), has confusing N:M semantics, and forces Mode to know adapter-specific identifiers.

7. **Pull-based event delivery, not push-based broadcast.** Mode owns an inbox and drains at its rhythm. Rationale: push-based delivery (current `body/percept` event) forces World/Interlude to reimplement buffering inside `handle()`, and the unserialized fan-out creates concurrent-delivery bugs.

8. **Session Log is one context-assembly strategy.** Appropriate for Chat Mode (append-only timeline of messages + events + tool calls). World and Interlude assemble context from domain state. The universal concept is "Execution Record" (observability trace), not "context source."

### Open for Future Resolution

- Exact Cordis mechanism for capability registration and discovery (service provision? typed registry? isolate-based scoping?)
- How multiple adapters of the same protocol are distinguished and selected by Mode
- Whether Mode needs explicit capability requirement declarations or discovers capabilities dynamically
- Feature negotiation granularity (how adapters declare optional feature support)
- Multi-Life routing semantics when sharing a capability source
- Whether Life should be a Cordis child context (enabling automatic scoping) or remain a logical entity within a flat context
- Naming: Life, Mode, Agent, Capability Protocol, Adapter are working terms
