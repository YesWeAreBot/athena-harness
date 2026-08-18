# Naming & Package Architecture

**Created**: 2026-08-18

**Status**: Decided

**Input**: Naming discussion (Life/Cortex/Nerve replacing Spirit/Pulse/Medium), package structure decisions for monorepo, extension mechanism design.

---

## Naming Decisions

### D-20: Three-Primitive Naming — Life / Cortex / Nerve

| Responsibility | Name | Chinese | Metaphor | Replaces |
|---|---|---|---|---|
| Persistent identity | **Life** | 生命 | A digital life itself | Spirit |
| Survival strategy | **Cortex** | 大脑皮层 | Cortical function: perception integration, decision, motor planning, temporal control | Pulse / Mode |
| World interface | **Nerve** | 神经通路 | Bidirectional conduit: sensory signals in, motor commands out | Medium / Body / Interface |

**Rationale**:
- **Life**: Directly maps to product goal ("digital life framework"). The original v1 name; strongest intuition. A Life IS persona + strategy + capabilities combined.
- **Cortex**: Anatomically accurate — the cerebral cortex handles perception integration, decision-making, motor planning, and temporal control. Does not imply switchability (you don't hot-swap a cortex). High distinctiveness; no TS keyword conflict.
- **Nerve**: Anatomically correct relationship with Cortex — nerves connect the brain to the external world. Bidirectional conduit (sensory nerves in, motor nerves out) perfectly maps to sense queues + act channels. Correct granularity (one nerve = one complete connection pathway).

**Unified metaphor**: Life operates through its Cortex (thinks/decides), which connects to the world through Nerves (perceives/acts).

### D-21: Supporting Concept Names

| Concept | Name | Definition |
|---|---|---|
| Deployment configuration | **Instance** | Declarative assembly YAML describing how a Life is composed (was "Life Config") |
| Cortex internal behavior switching | **Preset** | Dynamic strategy/style switching within a single Cortex (deferred) |

**Instance** replaces the earlier "Life Config" concept (D-17). Path: `instances/alice.yml`.

**Preset** is a Cortex-internal capability (D-19). Not a framework-level entity. Deferred until Cortex design stabilizes.

---

## Package Naming Convention

### D-22: Package Naming Scheme (Scheme C — Semantic Prefix)

**npm scope**: `@athena-ai` (working name; may be replaced later with final brand name)

**Rules**:

| Package type | Official pattern | Community (unscoped) | Community (scoped) |
|---|---|---|---|
| Core / infrastructure | `@athena-ai/core` | — | — |
| Cortex plugin | `@athena-ai/cortex-<name>` | `athena-cortex-<name>` | `@scope/athena-cortex-<name>` |
| Nerve plugin | `@athena-ai/nerve-<name>` | `athena-nerve-<name>` | `@scope/athena-nerve-<name>` |
| Generic plugin | `@athena-ai/plugin-<name>` | `athena-plugin-<name>` | `@scope/athena-plugin-<name>` |

**Rationale**:
- Cortex and Nerve are domain concepts that carry type information inherently — no need for redundant `plugin-` prefix.
- Generic plugins (memory, scheduler, etc.) that don't fit Cortex/Nerve taxonomy use the `plugin-` prefix, consistent with Cordis/Koishi ecosystem convention.
- Pure library packages (core, shared utils) have no prefix.

---

## Mode/Cortex Extension Mechanism

### D-23: Hook Protocol for Community Extensions

**Principle**: Convention over enforcement.

**Three extension layers**:

| Layer | Mechanism | Capability |
|---|---|---|
| Tool registration | Plugins register tools to `ctx.tools` | Add new LLM-accessible capabilities (Mode-agnostic) |
| Lifecycle hooks | Cortex emits Cordis events at key points | Transform data flowing through the Cortex pipeline |
| ~~Cortex mixin~~ | ~~Inject logic into Cortex internals~~ | ~~NOT supported — too high risk to internal consistency~~ |

**Hook protocol is recommended but not mandatory**:
- Framework defines a recommended set of hook names and signatures
- Cortex authors choose which hooks to emit (may be all, some, or none)
- Community plugins listen for hooks; if current Cortex doesn't emit them, plugin is silently inert

**Cordis dispatch modes for hooks**:

| Hook point | Dispatch mode | Semantics |
|---|---|---|
| `cortex/before-drain` | `waterfall` | Transform/filter perception events before integration |
| `cortex/after-integrate` | `waterfall` | Inject into assembled context (RAG, memory, etc.) |
| `cortex/before-cognition` | `waterfall` | Modify prompt/tools/parameters before LLM call |
| `cortex/before-enact` | `bail` | Intercept/veto actions (content moderation, rate limiting) |
| `cortex/after-enact` | `parallel` | Post-action side effects (logging, statistics, triggers) |

**Rationale**:
- Cordis natively supports `waterfall` (reducer pattern), `bail` (short-circuit), `parallel`, `serial`, and `emit` dispatch modes.
- `waterfall` = each listener receives previous output, returns transformed value → natural reducer/pipeline.
- This allows community plugins to extend Cortex behavior without understanding or modifying its internal loop.
- Cortex's structural integrity is preserved — plugins can only transform data at designated points, never hijack control flow.

---

## Capability Architecture

### D-27: Capability Packages as Core Contracts

**Principle**: Dependency inversion — Cortex depends on Capability (abstract contract), Nerve implements Capability (provides concrete implementation). Cortex never depends on a specific Nerve package.

```
Cortex  → depends on → Capability (interface/contract)
Nerve   → implements → Capability (provides implementation)
```

**Capability package responsibilities**:

1. **Service interface/base class** — defines the API shape for this capability
2. **Multi-instance container** — registration/discovery/addressing of Nerve instances
3. **Event type definitions** — which Cordis events this capability emits
4. **Shared types** — data structures used by both Nerve and Cortex

**Naming**: `@athena-ai/capability-<name>` (official), `athena-capability-<name>` (community)

**Dependency**: Each capability package depends on `@athena-ai/core`.

**Examples**:
- `@athena-ai/capability-message` — IM messaging contract (predefined by core team)
- `@athena-ai/capability-minecraft` — Minecraft world contract (future)
- `@athena-ai/capability-audio` — Audio I/O contract (future)

**Multi-Nerve contribution model**:
- Capability package defines a Service with a multi-instance registry
- Multiple Nerves can register instances into the same capability service
- Example: `ctx.message` has multiple Bots registered by different Satori adapters
- Cortex uses `inject = ['message']` and addresses specific instances via target parameters

### D-28: Sense Queue Replaced by Cordis Events

- No framework-level Sense Queue abstraction
- Nerve (via Capability) emits Cordis events (e.g., `message/receive`)
- Cortex internally subscribes via `ctx.on(...)` and manages its own consumption strategy
- Chat Cortex: immediate response on event
- World Cortex: internal buffer, drains on heartbeat
- Buffering/rhythm control is Cortex-internal implementation detail

### D-29: Cortex Contract — Cordis Service with inject

- Cortex IS a Cordis Service, installed via `ctx.plugin(CortexChat, config)`
- Uses `static inject = [...]` to declare required capabilities
- Uses `static optional = [...]` to declare optional capabilities
- Cordis validates inject dependencies — Cortex won't start if required capability is missing
- Life-level isolate context guarantees at most one Cortex per Life
- Lifecycle (start/stop/dispose) follows Cordis fiber semantics — no custom lifecycle methods needed

### D-30: Nerve Contract — Capability Contributor

- Nerve is a Cordis plugin that registers instance(s) into a Capability service
- IM Nerves register Bot(s) into `ctx.message` (capability-message container)
- Non-IM Nerves register connections into their respective capability services
- Nerve emits domain events through Cordis event system
- Nerve handles platform-specific connection, auth, reconnection internally
- Multiple Nerves of same type → multiple instances in same capability container

**"Service exists but no Nerve registered"**: `ctx.on(...)` receives no events; method calls fail because no addressable instance exists. Framework logs a warning.

---

## Monorepo Structure

### D-31: Package Directory Layout (revised)

```
athena-harness/
├── packages/
│   ├── core/                    ← @athena-ai/core
│   │                              Runtime core: Life management, Instance loader,
│   │                              Hook protocol, Capability base infrastructure,
│   │                              event envelope types
│   │
│   ├── capability/
│   │   ├── message/             ← @athena-ai/capability-message
│   │   ├── minecraft/           ← @athena-ai/capability-minecraft (future)
│   │   └── audio/               ← @athena-ai/capability-audio (future)
│   │
│   ├── cortex/
│   │   ├── chat/                ← @athena-ai/cortex-chat
│   │   └── world/               ← @athena-ai/cortex-world (future)
│   │
│   ├── nerve/
│   │   ├── satori/              ← @athena-ai/nerve-satori
│   │   └── minecraft/           ← @athena-ai/nerve-minecraft (future)
│   │
│   ├── plugin-memory/           ← @athena-ai/plugin-memory
│   └── plugin-scheduler/        ← @athena-ai/plugin-scheduler (future)
│
├── vendor/
│   └── satori/                  ← Satori v5 vendored from git
│       ├── core/                  @satorijs/core 5.0.0-alpha.0
│       ├── protocol/              @satorijs/protocol 2.0.0-alpha.0
│       ├── element/               @satorijs/element 4.0.0-alpha.0
│       └── adapter-satori/        @satorijs/adapter-satori 2.0.0-alpha.0
│
├── legacy/                      ← Superseded code archive
│
├── docs/
├── .specify/
├── turbo.json
└── package.json
```

**Workspace configuration**:
```jsonc
{
  "workspaces": [
    "packages/*",
    "packages/*/*",
    "vendor/*/*"
  ]
}
```

**Design choices**:
- `core` and `protocol` merged into single `@athena-ai/core` — split later if needed.
- `capability/` sub-directory for all capability contract packages.
- `cortex/` and `nerve/` have sub-directories (multiple implementations expected).
- `plugin-xxx` lives at `packages/` top level (not nested under `packages/plugin/`).
- Vendor packages in `vendor/` directory, separate from authored packages.
- Superseded code moved to `legacy/` (preserved in git history).

### D-32: Dependency Graph (revised)

```
@athena-ai/core                      ← cordis ^4.0.0-rc.8, cosmokit
       ↑
@athena-ai/capability-message        ← core
@athena-ai/capability-minecraft      ← core
       ↑                    ↑
@athena-ai/nerve-satori      │       ← capability-message, vendor/satori
@athena-ai/nerve-minecraft    │       ← capability-minecraft
       (no dependency)        │
@athena-ai/cortex-chat        │       ← capability-message, ai (AI SDK v7)
@athena-ai/cortex-world ──────┘       ← capability-message, capability-minecraft, ai
@athena-ai/plugin-memory              ← core
```

**Key rule**: Cortex depends on `capability-xxx`, NEVER on `nerve-xxx`.
---

## Cortex Non-Switchability Reaffirmed

### D-26: Cortex Lifecycle

- Cortex is NOT hot-switchable at runtime (reaffirms D-04 from prior spec)
- Different Cortices have incompatible state structures
- Changing Cortex = explicit stop + start sequence; Life memory persists, Cortex-internal state is lost
- Preset (Cortex-internal behavior style) IS dynamically switchable — deferred to Cortex contract design

---

## Superseded Naming

All prior references to Spirit/Pulse/Medium in specs and documents should be read as Life/Cortex/Nerve respectively. Specs will be updated during implementation phase.

| Old term | New term |
|----------|----------|
| Spirit | Life |
| Pulse | Cortex |
| Medium | Nerve |
| Life Config | Instance |
| Pulse preset | Cortex Preset |
