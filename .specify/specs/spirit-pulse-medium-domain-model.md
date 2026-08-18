# Feature Specification: Spirit–Pulse–Medium Domain Model

**Feature Branch**: `spirit-pulse-medium-domain-model`

**Created**: 2026-08-18

**Status**: Draft

> **⚠️ Naming Caveat**: "Spirit", "Pulse", "Medium" are **provisional working terms** used throughout this document for conceptual clarity. They are NOT finalized names. The three-primitive structural model (identity / survival-strategy / world-interface) is the design decision; the specific terminology remains open for discussion.

**Input**: Domain modeling session for Athena Harness. Establish a first-principles entity model (Spirit, Pulse, Medium) for a native digital life framework, replacing all prior Body/Mode/Capability-Protocol designs. Define how a digital existence persists identity, operates through a survival strategy, and interfaces with the world through media — platform-agnostic, supporting IM, 3D worlds, expression systems, and physical embodiments.

## Design Philosophy

This framework is **not** a generic bot framework, **not** a domain-agnostic agent runtime. It is a framework kernel specifically for **anthropomorphic AI / digital life** — entities that "live" rather than merely "respond."

The design starts from a single question: **what does a digital existence need to be alive?**

The answer reduces to three primitives:

1. **Spirit** — "Who am I?" — continuous identity across time
2. **Pulse** — "How do I live?" — the complete survival strategy that drives existence
3. **Medium** — "Where do I exist?" — the contact surfaces between self and world

These three primitives unify three radically different products (YesImBot chat, YesImBotWorld continuous agent, HDS-Interlude narrative engine) into one composable system.

## Core Entity Model

### Spirit (精神/灵)

> The continuous identity that persists across time. Not configuration — existence.

Spirit holds everything that makes one existence "this existence" rather than another:

- **Persona essence** — not a prompt template, but a compressed representation of character
- **Accumulated memory** — experience sediment (vectors, text, structured, or hybrid)
- **Self-model** — self-awareness of current state ("I'm tired today", "I have an opinion about this")

Spirit **does not know** how it perceives or acts. It simply "is."

**Lifecycle**: Spirit persists across process restarts, across Pulse changes, across Medium additions/removals. It is the one constant.

**Cordis mapping**: Spirit = a child context (isolate) under the root, providing identity-scoped services.

---

### Pulse (脉搏/心跳)

> The survival strategy that drives existence. Determines "when to think" and "how to think."

Pulse is the complete orchestration of how a digital life operates:

- **Rhythm** (节律): What conditions trigger a "moment of consciousness"?
- **Integration** (整合): How are perceptions from multiple Media synthesized into unified awareness?
- **Cognition** (思考): How is this unified input processed (multi-step reasoning, single decision, structured generation)?
- **Enactment** (执行): How are cognitive results distributed back to Media as actions?
- **Continuation** (延续): After this moment, when does the next one come?

Pulse is **the whole replaceable unit** — a complete, self-consistent operational pattern. It is NOT decomposed into independent axes.

**Three canonical Pulse patterns:**

| Pulse Pattern | Rhythm | Integration | Cognition | Enactment |
|---|---|---|---|---|
| Reactive (Chat) | External message arrival | Immediate; single-source degenerate | Finite tool-loop | Direct action dispatch |
| Continuous (World) | Never stops; internal heartbeat | Buffered mailbox; "phone" metaphor | One tool-call per beat, forever | Deferred/scheduled dispatch |
| Narrative (Interlude) | Accumulated stimuli reach threshold | Debounced; multi-message aggregation | Single structured-output | Story-DB mutation + message |

**Non-switchability**: Pulse cannot be dynamically switched at runtime. Different Pulses have incompatible state structures (session log vs. world files vs. story DB). Changing how an existence "lives" = stopping old Pulse, starting new Pulse. Spirit memory persists; Pulse-internal state is lost (analogous to "changing careers — memories remain, work context resets").

**Capability expansion without Pulse change**: Adding new abilities (e.g., Minecraft) is done by installing new Medium plugins, NOT by switching Pulse. The Pulse's core loop is unchanged; only the available tool pool and perception sources expand.

**Development/publishing model**: Each Pulse is an independent product/package:
- `@athena/pulse-chat` — reactive chat survival strategy
- `@athena/pulse-world` — continuous world-agent survival strategy
- `@athena/pulse-interlude` — narrative-driven survival strategy

**Cordis mapping**: Pulse = a plugin installed within the Spirit context, owning a complete fiber lifecycle. One Spirit, at most one active Pulse.

---

### Medium (介质/媒介)

> The contact surface between existence and world. Not "adapter" — the substance through which an existence is present.

A digital life does not "own" a body — it **exists through media**. Multiple Media operate simultaneously (not mutually exclusive), like a human simultaneously seeing, hearing, and touching.

```
Spirit's awareness field
  ├── Through IM Medium: perceives "someone @'d me in the group"
  ├── Through World Medium: perceives "it's 3pm, time to rest"
  └── Through Expression Medium: (no input; passively maintains current expression)
```

Each Medium provides:

1. **Sense channels** — world state flowing into existence (event queue, pullable)
2. **Act channels** — existence's will flowing toward the world (callable)
3. **Presence** — what the existence "is" in that medium (avatar, name, status)

**Not mutually exclusive**: A digital life exists in ALL its active Media simultaneously. Pulse faces the confluence of all Media, not one at a time.

**Pull-based perception**: Media maintain sense queues. Pulse drains them at its own rhythm. Chat Pulse drains immediately; World Pulse drains on its heartbeat schedule; Narrative Pulse drains after debounce.

**Cordis mapping**: Medium = a plugin providing services (structured capabilities + tool registrations). Hot-installable and hot-removable via Cordis plugin lifecycle.

---

## Three-Layer Tool Model

LLM-consumed tools come from three distinct sources with different ownership:

### Layer 1: Structured Capabilities (结构化能力)

- **Defined by**: Medium
- **Consumed by**: Pulse code (programmatic calls)
- **Abstraction level**: Unified protocol (e.g., `messaging.send(target, content)`)
- **Purpose**: Pulse's deterministic logic depends on these (output queuing, state updates, session management)
- **Example**: `messaging.send()`, `messaging.getUnread()`, `scheduler.sleep()`

### Layer 2: Product-Semantic Tools (产品语义工具)

- **Defined by**: Pulse
- **Consumed by**: LLM (via tool-calling)
- **Abstraction level**: Product concepts (not platform operations)
- **Purpose**: The tools LLM sees are product-meaningful actions, not raw platform APIs
- **Example**: "send_message" (= character speaks), "check_phone" (= look at phone), "wait" (= let time pass)
- **Implementation**: Internally calls structured capabilities

### Layer 3: Platform Passthrough Tools (平台透传工具)

- **Defined by**: Medium (self-describing, full-fidelity)
- **Consumed by**: LLM (directly, without Pulse understanding them)
- **Abstraction level**: Platform-native (all capabilities preserved)
- **Purpose**: Platform-specific operations that LLM can discover and use without Pulse needing to comprehend
- **Example**: `onebot.poke`, `onebot.set_group_card`, `discord.create_thread`
- **Control**: Whether/which passthrough tools are exposed is configurable per deployment

### Why This Matters

- **No lowest-common-denominator abstraction**: Platforms expose their FULL capabilities. LLM generalizes at runtime.
- **Pulse stays platform-agnostic**: Pulse code uses only structured capabilities (Layer 1) and defines its own semantic tools (Layer 2). It never references platform-specific operations.
- **LLM is the consumer of platform diversity**: Platform differences are resolved by LLM's generalization ability, not by human developers writing adapter code.
- **Mode developer doesn't package platform capabilities**: The "re-packaging" Mode developers do is defining product-semantic tools (Layer 2), NOT wrapping platform APIs.

---

## Relationships Between Primitives

```
Spirit  ←→  Pulse  ←→  Medium(s)
  │            │            │
 "Who I am"  "How I live"  "Where I exist"
```

- **Spirit → Pulse**: Spirit activates a Pulse. Pulse references Spirit for persona continuity.
- **Pulse → Medium**: Pulse declares what structured capabilities it needs. Pulse collects tools from Medium(s). Pulse drains Medium sense queues.
- **Spirit → Medium**: Indirect. Spirit does not interact with Medium directly; everything is mediated by Pulse.

### Composition Examples

| Scenario | Spirit | Pulse | Medium(s) |
|---|---|---|---|
| Group chat bot | Alice persona | Reactive (message→think→reply) | IM(OneBot) |
| Virtual world resident | Alice persona | Continuous (perpetual heartbeat) | IM(OneBot) + World(filesystem) |
| Screenplay character | Character persona | Narrative (accumulate→narrate) | Story(database) + IM(OneBot) |
| Streaming VTuber | VTuber persona | Reactive + scheduled | IM + Audio + Live2D |
| MC-playing world bot | Alice persona | Continuous (perpetual heartbeat) | IM(OneBot) + Minecraft + World |

---

## Multi-Medium Perception Integration

When multiple Media are active, Pulse must integrate their perceptions into a unified "moment of consciousness."

```
     ┌──── Medium A (IM) ─── sense queue ──┐
     │                                      │
Pulse│──── Medium B (World) ── sense queue ──┼──→ Integration → Cognition → Enactment
     │                                      │         ↑
     └──── Medium C (Live2D) ─ sense queue ──┘         │
                                                  Rhythm control
                                                (when to produce next
                                                  consciousness moment)
```

**Integration strategy is Pulse-internal:**
- Chat Pulse: degenerate (single-source, immediate)
- World Pulse: "phone" metaphor — IM events are wrapped inside World perception ("your phone lit up"), not directly consumed
- Narrative Pulse: debounce-buffer — multiple messages are aggregated before triggering one narrative turn

**Action dispatch is also multi-path:**
```
Cognition result → Pulse dispatch ──→ Medium A: "send a message"
                                  ──→ Medium B: "update world state"
                                  ──→ Medium C: "change expression"
```

---

## Internal Event Protocol

While Medium tools are platform-specific and self-describing, the **event flow into Pulse** follows a minimal unified protocol:

### Unified event envelope:
- `kind`: event classification ("message", "state-change", "timer", "system")
- `source`: origin identifier (medium + channel)
- `timestamp`: when it occurred
- `content`: rich content in unified format
- `raw`: platform-original data (available but not required for Pulse logic)

### Unified content model:
- Messages use a common rich-text representation (text, image, audio, quote — container format)
- Not platform-native format, but a lossless internal representation

### What is NOT unified:
- Tool definitions (each Medium self-describes its own)
- Platform-specific event details (preserved as `raw`)
- Presence schema (each Medium defines its own)

---

## User Scenarios & Testing

### User Story 1 — Medium Developer Bridges a Platform (Priority: P1)

As a Medium developer, I want to write a plugin that bridges a concrete platform (e.g., OneBot/Discord/Minecraft) to the framework by declaring structured capabilities and registering passthrough tools, so that any Pulse requiring those capabilities can function through my Medium.

The Medium:
- Converts platform events to unified internal events (sense)
- Exposes structured capability methods (act)
- Registers platform-native tools for LLM consumption (passthrough)
- Handles all platform specifics internally (connection, auth, format conversion)

**Why this priority**: Without Media, existence has no contact with the world.

**Independent Test**: Install a mock IM Medium, verify it registers structured capabilities and passthrough tools into the Cordis context, and confirm events flow into the sense queue.

**Acceptance Scenarios**:

1. **Given** a Cordis context with Athena Runtime, **When** a OneBot Medium plugin is installed, **Then** the `messaging` structured capability is available and passthrough tools (poke, set_card, etc.) are registered in the tool pool.
2. **Given** an installed IM Medium receiving platform events, **When** a message arrives, **Then** it is converted to unified event format and placed in the sense queue (not pushed to Pulse).
3. **Given** a Medium providing passthrough tools, **When** Pulse assembles an Agent, **Then** those tools are included in the LLM tool set with self-describing schemas.
4. **Given** two Media providing the same structured capability (e.g., OneBot IM + Discord IM), **When** Pulse queries for `messaging`, **Then** both are discoverable and independently addressable.

---

### User Story 2 — Pulse Developer Creates a Survival Strategy (Priority: P1)

As a Pulse developer, I want to implement a complete survival strategy by defining rhythm, integration, cognition, enactment, and continuation — consuming structured capabilities from Medium(s) and defining product-semantic tools for LLM — without knowing concrete platforms.

The Pulse:
- Declares required structured capabilities (e.g., `requires: [messaging]`)
- Defines product-semantic tools (Layer 2) that call structured capabilities internally
- Controls when to drain sense queues (rhythm)
- Assembles context for LLM calls (integration + prompt)
- Interprets LLM output and dispatches actions (enactment)

**Why this priority**: Pulse is the core differentiator — the "how a life operates" logic.

**Independent Test**: Write a minimal Chat Pulse, install alongside a mock IM Medium, verify the Pulse drains messages immediately, invokes LLM, and dispatches responses.

**Acceptance Scenarios**:

1. **Given** a Chat Pulse declaring `requires: [messaging]`, **When** installed in a context where an IM Medium is present, **Then** Pulse successfully activates and begins its rhythm.
2. **Given** a Chat Pulse, **When** IM Medium receives a message, **Then** Pulse drains it immediately, assembles context, calls LLM with product-semantic tools, and dispatches the response through `messaging.send()`.
3. **Given** a World Pulse with a heartbeat rhythm, **When** multiple IM events arrive between heartbeats, **Then** events accumulate in the sense queue and are drained together at next heartbeat.
4. **Given** a Pulse declaring `requires: [messaging]`, **When** installed in a context with NO messaging Medium, **Then** activation fails with a clear error.
5. **Given** a Pulse that defines product-semantic tools and a Medium that registers passthrough tools, **When** Agent is assembled, **Then** LLM sees both tool sets (Layer 2 + Layer 3).

---

### User Story 3 — End User Composes a Digital Life (Priority: P1)

As an end user (deployer), I want to compose a digital life by installing plugins — choosing a Spirit (identity), a Pulse (survival strategy), and Medium(s) (world interfaces) — through declarative configuration without imperative wiring.

**Why this priority**: The Cordis-native composition promise. If deployment requires manual wiring, the framework's core value proposition fails.

**Independent Test**: Write a minimal config installing Spirit + Chat Pulse + OneBot Medium, start the context, verify the life responds to messages with zero explicit wiring code.

**Acceptance Scenarios**:

1. **Given** a Cordis root context, **When** user installs AthenaRuntime + AliceSpirit + ChatPulse + OneBotMedium as plugins, **Then** the system self-assembles: Alice operates in chat mode via OneBot.
2. **Given** a running life, **When** user additionally installs MinecraftMedium, **Then** new capabilities (tools) become available to LLM without restart.
3. **Given** a running life, **When** MinecraftMedium is removed, **Then** associated tools disappear from LLM's available set; Pulse continues operating with remaining Media.
4. **Given** a Spirit with persona and memory, **When** the process restarts, **Then** Spirit state is restored from persistence; Pulse resumes its rhythm.

---

### User Story 4 — Pulse Controls Perception Mediation (Priority: P2)

As a World Pulse developer, I want to mediate perception — raw IM events don't directly reach the Agent's awareness; instead, they enter a "phone" mailbox and the Bot must choose to "check the phone" to see them.

**Why this priority**: This is what distinguishes the three products. Without mediation, World and Interlude collapse into Chat. Depends on P1 capabilities being solved.

**Independent Test**: Write a World Pulse subscribing to IM events but buffering them. Verify 5 messages arrive without triggering Agent execution until the internal scheduler fires.

**Acceptance Scenarios**:

1. **Given** a World Pulse with mailbox buffering, **When** 3 messages arrive while Bot is "resting," **Then** messages accumulate but do NOT trigger cognition.
2. **Given** a World Pulse in "phone-up" state, **When** scheduler triggers a drain, **Then** accumulated messages are transformed into Agent-facing percepts ("you see 3 new messages").
3. **Given** a Narrative Pulse, **When** messages arrive, **Then** they enter a debounce buffer; narrative turn fires only after debounce window expires.
4. **Given** a Chat Pulse, **When** a message arrives, **Then** it immediately triggers cognition (degenerate case: no mediation).

---

### User Story 5 — Medium Extensibility (Priority: P2)

As a framework extender, I want to define new Medium types (e.g., Audio, Haptic, VR) beyond built-in ones, using the same mechanism as built-in Media.

**Why this priority**: The framework's ambition is digital life, not just chat bots. But built-in Media come first.

**Independent Test**: Define a custom "Audio" Medium with sense (incoming-audio) and act (speak, play), verify a Pulse can discover and use it identically to built-in IM.

**Acceptance Scenarios**:

1. **Given** a user-defined Audio Medium, **When** installed, **Then** its structured capabilities and passthrough tools are discoverable through the same mechanism as built-in IM.
2. **Given** a Pulse declaring `optional: [audio]`, **When** Audio Medium is present, **Then** Pulse can drain audio events and invoke audio actions.
3. **Given** a Pulse declaring `optional: [audio]`, **When** Audio Medium is absent, **Then** Pulse gracefully operates without it.

---

### User Story 6 — Multiple Lives, Shared Platform (Priority: P3)

As a deployer running multiple AI personas, I want two or more Spirits to share a single platform Medium, with clear routing semantics.

**Why this priority**: Future capability. Design must not preclude it; v1 targets single-Spirit.

**Acceptance Scenarios**:

1. **Given** two Spirits both subscribing to the same IM Medium, **When** a message arrives, **Then** both receive the event independently (each in their own sense queue).
2. **Given** two Spirits sharing an IM Medium, **When** Alice's Pulse sends a message, **Then** the message is attributed correctly.
3. **Given** a deployment wanting isolated routing (Alice=channel A, Bob=channel B), **When** configuring subscriptions, **Then** each Spirit filters at the subscription boundary.

---

### Edge Cases

- **Medium disconnects mid-operation** (e.g., WebSocket drops): Sense queue signals disconnection; Pulse decides how to handle (wait, degrade, error). Medium handles reconnection internally.
- **Medium removed while Pulse depends on it**: If the removed capability was `required`, Pulse enters error state. If `optional`, Pulse degrades gracefully.
- **Multiple Media provide same structured capability**: Pulse must be able to address them independently (e.g., "send via OneBot" vs "send via Discord"). Mechanism TBD (Cordis isolate? metadata filtering?).
- **Pulse attempts to switch at runtime**: Framework rejects. Pulse change requires full stop + restart.
- **Spirit memory migration on Pulse change**: Spirit's generic memory (persona, facts, relationships) persists. Pulse-specific state (session log, world files, story DB) is acknowledged as lost.

---

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a Spirit entity that persists identity (persona, memory, self-model) independently of Pulse lifecycle.
- **FR-002**: System MUST enforce at most one active Pulse per Spirit at any time.
- **FR-003**: Pulse MUST declare required and optional structured capabilities; framework MUST validate availability at activation time.
- **FR-004**: Medium MUST be hot-installable and hot-removable at runtime via Cordis plugin lifecycle.
- **FR-005**: Event delivery from Medium to Pulse MUST be pull-based. Medium maintains sense queues; Pulse controls drain rhythm.
- **FR-006**: Event drain within a Pulse MUST be serialized by default (no concurrent cognition invocations unless Pulse explicitly opts in).
- **FR-007**: Medium MUST expose both structured capabilities (programmatic, for Pulse code) and passthrough tools (self-describing, for LLM).
- **FR-008**: Pulse MUST define product-semantic tools (Layer 2) that internally call structured capabilities. LLM never directly invokes raw structured capabilities.
- **FR-009**: Passthrough tools from Medium MUST be includable in Agent's tool set without Pulse understanding their semantics.
- **FR-010**: Spirit disposal MUST automatically clean up Pulse, all subscriptions, and associated resources via Cordis fiber lifecycle.
- **FR-011**: Composition MUST be Cordis-native: plugin installation establishes capability availability — no imperative wiring.
- **FR-012**: Internal event protocol MUST define a minimal unified envelope (kind, source, timestamp, content, raw) for events flowing from Medium to Pulse.
- **FR-013**: Message content MUST use a unified rich-text representation (text, image, audio, quote) regardless of source platform.
- **FR-014**: Scheduling and trigger logic MUST be Pulse-internal. Framework provides timer/scheduling primitives; strategy belongs to Pulse.
- **FR-015**: The framework MUST NOT support runtime Pulse switching. Changing Pulse requires explicit stop + start sequence.
- **FR-016**: Spirit's generic memory MUST survive Pulse changes. Pulse-specific state loss is acceptable and expected.
- **FR-017**: Multiple Media of the same type (e.g., two IM adapters) MUST be distinguishable and independently addressable.

### Key Entities

- **Spirit**: Persistent identity. Owns persona (character definition), accumulated memory (experience sediment), and self-model (current-state awareness). Exists within a Cordis child context (isolate). One Spirit per identity; survives process restarts and Pulse changes.

- **Pulse**: Complete survival strategy — rhythm, integration, cognition, enactment, continuation. Creates and manages internal Agents. Subscribes to Medium sense queues. Acts through structured capabilities. Defines product-semantic tools. One active Pulse per Spirit; not dynamically switchable. Published as independent packages.

- **Medium**: Cordis plugin bridging a concrete platform/world to the framework. Provides structured capabilities (for Pulse code), passthrough tools (for LLM), sense queues (perception), and presence state. Hot-installable/removable. Multiple Media coexist simultaneously.

- **Structured Capability**: An abstract interface for a category of interaction (e.g., messaging, world-state, audio). Defined by Medium, consumed by Pulse code. Provides the programmatic API that Pulse's deterministic logic depends on.

- **Passthrough Tool**: A self-describing, platform-native tool registered by Medium for direct LLM consumption. Pulse code does not interpret these; they flow through the Agent's tool-call → execute → result cycle transparently.

- **Product-Semantic Tool**: A tool defined by Pulse representing a product-meaningful action ("send_message", "check_phone", "wait"). Implementation calls structured capabilities. This is what LLM primarily interacts with.

- **Sense Queue**: A per-Medium, pull-based event buffer. Medium writes; Pulse reads at its own rhythm. Guarantees ordering. Serializes delivery unless Pulse opts into parallelism.

- **Unified Event Envelope**: The minimal protocol for events flowing from Medium to Pulse: kind, source, timestamp, content (unified rich-text), and raw (platform-original, optional).

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: A Pulse developer can write a complete survival strategy consuming `messaging` capability without importing any platform-specific package or referencing any platform identifier.
- **SC-002**: A Medium developer can bridge a new platform by implementing structured capabilities and registering passthrough tools — with zero changes to existing Pulses or Spirit configurations.
- **SC-003**: An end user can compose a working digital life (Spirit + Pulse + Medium) using only plugin installation — zero imperative wiring.
- **SC-004**: Three reference Pulses (Chat, World, Interlude) can be implemented on this framework, each demonstrating its unique rhythm/integration/cognition pattern, all sharing the same Medium infrastructure.
- **SC-005**: Installing a new Medium at runtime makes new tools available to LLM without Pulse code change or restart.
- **SC-006**: Removing a Medium at runtime cleanly removes associated tools and sense sources — verified by checking no dangling state.
- **SC-007**: Disposing a Spirit automatically cleans up Pulse and all Medium subscriptions — verified by checking no dangling listeners.
- **SC-008**: Platform-specific passthrough tools (e.g., OneBot's 80 operations) are fully available to LLM without any Pulse-side wrapping code.

---

## Assumptions

- Cordis v4 is the composition substrate. Context inheritance, Service provision, Fiber lifecycle, events, and isolate mechanisms are available and stable.
- AI SDK v7 is the model-calling substrate (generateText, streamText, tool mechanics, structured output).
- The framework does NOT attempt to be a general-purpose agent runtime. It is specifically for anthropomorphic AI / digital life.
- Initial implementation targets IM (messaging) as the first structured capability. Others follow.
- Pulse switching is NOT supported at runtime (design decision). Stop + start is the migration path.
- Multi-Spirit scenarios are future work; v1 targets single-Spirit deployment.
- The existing `packages/athena-runtime/src/body/` and `packages/athena-runtime/src/life/` code is fully superseded.
- "Session Log" as append-only timeline serves Chat Pulse well; other Pulses use their own context-assembly strategies. The universal observability concept is "Execution Record."
- Tool definitions follow AI SDK v7's tool schema (name, description, parameters via zod, execute function).

---

## Design Decisions & Rationale

### Decided

1. **Three-primitive structural model (provisionally: Spirit/Pulse/Medium).** The decision is the three-primitive decomposition — identity / survival-strategy / world-interface — replacing all prior framings (Life/Mode/Body, Life/Mode/Capability-Protocol). The specific names are working terms, not finalized. Rationale: captures the essential nature of digital existence from first principles without importing bot-framework or agent-runtime assumptions.

2. **No separate Harness Core layer.** Substrate is Cordis + AI SDK directly. Athena Runtime IS the framework. Rationale: extracting a generic agent-execution layer provides no value over what Cordis + AI SDK already offer.

3. **Pulse is the whole replaceable unit.** Not decomposed into independent axes. The "six axis" analysis was useful for understanding but axes co-vary in practice. Rationale: attempts to decompose into "trigger strategy" + "context strategy" + "execution strategy" as independent slots produced artificial boundaries; real Pulses are holistically designed.

4. **Pulse cannot be dynamically switched.** Different Pulses have incompatible state structures (session log vs world files vs story DB). Rationale: state migration between fundamentally different consciousness models is a lossy, risky operation with minimal practical benefit. Capability expansion is achieved by adding Media, not switching Pulse.

5. **Three-layer tool model.** Structured capabilities (Pulse code calls) / Product-semantic tools (Pulse defines for LLM) / Platform passthrough tools (Medium registers for LLM). Rationale: resolves the tension between "Pulse must be platform-agnostic" and "LLM should access full platform capabilities" — Pulse code uses Layer 1, LLM uses Layers 2+3, platform fidelity is preserved without Pulse coupling.

6. **No lowest-common-denominator platform abstraction.** Each Medium exposes its platform's FULL capabilities as passthrough tools. LLM generalizes across platforms at runtime. Rationale: traditional bot-framework unification (80 platform methods → 20 universal methods) loses 80% of capability. Our consumer (LLM) doesn't need compile-time type safety; it needs discoverability and self-description.

7. **Pull-based perception, not push-based.** Medium maintains sense queues; Pulse pulls at own rhythm. Rationale: push-based forces World/Interlude to reimplement buffering; causes concurrent-delivery bugs; prevents Pulse from controlling its own consciousness rhythm.

8. **Multiple Media are simultaneous, not mutually exclusive.** A digital life exists in ALL its active Media at once. Rationale: humans simultaneously perceive through multiple senses. A bot can simultaneously exist in chat + minecraft + have a webcam. The Pulse integrates multi-source perceptions into unified awareness.

9. **Agent is Pulse-internal.** Not a framework-level entity. Rationale: the three products use "agents" in radically different ways (finite tool-loop, continuous single-step, structured-output). Unifying as a framework entity forces false commonality.

10. **Scheduling is Pulse-internal.** Framework provides primitives; strategy belongs to Pulse. Rationale: scheduling is deeply product-specific (Interlude's debounce, World's heartbeat, Chat's immediate dispatch).

11. **Session Log is one context-assembly strategy.** Appropriate for Chat Pulse. World/Interlude assemble from domain state. Universal concept is "Execution Record" (observability trace). Rationale: mandating append-only logs forces World/Interlude into awkward patterns.

12. **Pulse = independent product package.** Published as `@athena/pulse-*`. End user installs one Pulse to define how their AI lives. Rationale: mirrors the relationship between DSH profiles and the core framework — a Pulse bundles a complete operational pattern.

### Open for Future Resolution

- Exact Cordis mechanism for structured capability registration/discovery (service provision? isolate-based scoping?)
- How multiple Media providing the same structured capability are distinguished and addressed by Pulse
- Feature negotiation granularity (how Media declare optional feature support within a capability)
- Multi-Spirit routing semantics when sharing a Medium
- Whether Spirit should use Cordis `isolate()` for automatic scoping or a simpler child-context pattern
- Naming: Spirit, Pulse, Medium are **working terms** chosen for conceptual clarity. Final naming TBD.
- Execution Record format and persistence mechanism
- Memory model: what constitutes "Spirit-level memory" vs "Pulse-specific state"
- Tool pool composition: exact mechanism for collecting Layer 2 + Layer 3 tools into Agent calls

---

## Superseded Designs

This spec supersedes:
- `.specify/specs/capability-protocol-and-entity-model.md` (2026-08-17) — the Capability Protocol + Body rejection + Mode-as-unit design. Key decisions preserved (no Body/string-ID, no Harness Core layer, pull-based events, Agent is internal) but entity model and tool model are fundamentally revised.
- All code in `packages/athena-runtime/src/body/` and `packages/athena-runtime/src/life/` — the BodyRegistry/LifeRegistry implementation.
