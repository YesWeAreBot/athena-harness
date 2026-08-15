# Athena Harness

Athena Harness is a Yarn workspaces monorepo. `@yesimbot/harness-core` is a small, platform-agnostic agent-runtime toolkit built directly on **Cordis v4** and **AI SDK v7**. `@yesimbot/athena-runtime` is the digital life framework layer and the next YesImBot core.

> Status: early prototype. This repository contains Harness core slices and early Athena Runtime contracts (`SessionStore`, `AgentRegistry`, `Surface`, `ModelSurface`, `BodyRegistry`, `Persistence`, `ToolRuntime`, `SystemPrompt`, real `agentLoop`); the full digital life runtime has not landed yet. See [docs/design.md](./docs/design.md) and [athena-runtime-design.md](./docs/athena-runtime-design.md).

## Repository Status

| Item                   | Value                                                                                                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Package                | `@yesimbot/harness-core`, `@yesimbot/athena-runtime`                                                                                                                                                  |
| Visibility             | Private prototype                                                                                                                                                                                     |
| Topology               | Yarn workspaces monorepo                                                                                                                                                                              |
| Package manager        | Yarn 4, `node-modules` linker                                                                                                                                                                         |
| Dependencies           | `cordis`, `ai`, `cosmokit`, `schemastery`                                                                                                                                                             |
| Source of truth        | Harness core: `docs/design.md`; Athena Runtime: `docs/athena-runtime-design.md`                                                                                                                       |
| Current implementation | Core slices: `SessionStore`, `AgentRegistry`, `Surface`, `ModelSurface`, `BodyRegistry`, `Persistence`, `ToolRuntime`, `SystemPrompt`, Agent Events, `LifeRegistry`, `ModeRegistry`, real `agentLoop` |

The repository deliberately does not contain a Koishi integration, a YesImBot-compatible runtime, or a copy of deepseek-harness's application framework. The first version is intended to prove the smallest viable Cordis-based kernel before it becomes a shared foundation for YesImBot modes and community modes.

## Goals

- Use upstream Cordis v4 for plugin composition, service dependencies, effect ownership, and disposal.
- Use stable AI SDK v7 types and `streamText()` directly.
- Expose a stable `ctx.agents` registry while keeping Agent definitions separate from the Agent Loop provider.
- Keep extensions dependent on stable Service Definitions rather than concrete Providers.
- Preserve structured, declaration-mergeable Session Events as durable facts.
- Derive AI SDK `ModelMessage[]` from the Session Event log without persisting external input as a pre-rendered `user/message` event.
- Validate tool registration, prompt assembly, dynamic context snapshots, Session persistence, restoration, and continuation.
- Keep the first implementation small enough to discard if its core assumptions fail.

## Design Overview

Athena Harness is a **minimal harness SDK/kernel**. The embedding application owns one Cordis root context and explicitly installs the Services and Providers it wants. Athena Harness does not provide a top-level `createRuntime()` factory or a default Core bundle.

One root may host multiple live Agents. Each Agent owns one scoped Cordis context, one Session, and one AI SDK `LanguageModel`. The Agent Loop drives one `streamText()` call per Step and owns Step progression, durable checkpoints, and tool execution boundaries.

### Relationship to the YesImBot Roadmap

Athena Harness is the kernel prototype for a later mode-oriented Cordis framework:

- `@yesimbot/framework` is planned to expose shared framework services and a first-class Mode registry.
- Chat, World, and community-created modes are planned as equal plugins, not built into the framework.
- Koishi is planned to become an optional transport adapter, not a framework dependency.
- Platform access is planned to go through transport interfaces such as Satori or a Koishi bridge.
- World is planned to be redesigned as a Mode plugin that uses framework transport, model, store, and scheduler services.

This README and the design document keep the first version intentionally kernel-only. The repository is now a Yarn workspaces monorepo with `@yesimbot/harness-core` and `@yesimbot/athena-runtime`. Mode registries, transport adapters, mode packages, and a separate WebUI are target architecture, not current implementation.

### Core Services

| Context key        | Public service  | Responsibility                                                                                                 |
| ------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `ctx.agents`       | `AgentRegistry` | Multi-Agent creation, restoration, lookup, ownership, and the registered `AgentFactory` slot.                  |
| `ctx.sessions`     | `SessionStore`  | Live Session preparation, publication, lookup, and removal. It does not own model projection.                  |
| `ctx.modelSurface` | `ModelSurface`  | Root-global Event-to-model projection and deterministic AI SDK `ModelMessage[]` derivation.                    |
| `ctx.tools`        | `ToolRuntime`   | Root and Agent-scoped AI SDK Tool registration, shadowing, and immutable per-Step composition.                 |
| `ctx.systemPrompt` | `SystemPrompt`  | Root and Agent-scoped static prompt sections and dynamic runtime-context contributions.                        |
| `ctx.persist`      | `Persistence`   | Optional durable Session preparation, append, flush, and restoration. The JSONL backend is the first Provider. |

`agent-loop` is not a public Service. It is a concrete Agent-factory plugin that injects the stable Services and registers its factory through `ctx.agents.setFactory()`. Consumers depend on `agent`, not on `agent-loop`.

### Agent and Session Model

- A **Session** is one Agent's durable source of truth: one header, an append-only sequence of Session Events, deterministic model Surface derivation, and optional JSONL persistence.
- An **Agent** is a temporary live execution driver with one scoped Cordis context and one Session. A Session can be restored into a newly composed Agent after the previous Agent is disposed.
- A **Turn** is one accepted external input followed by zero or more model Steps and one final outcome.
- A **Step** is one AI SDK model call and the tool activity produced by that call.
- Only one Turn may be active per Agent in the first version.

Session Events are the only durable execution records. The event vocabulary is declaration-mergeable, while the model Surface is closed to three semantic categories: `user/message`, `assistant/message`, and `tool/result`. Custom events may project to `user/message` through a registered pure projector without writing a duplicate user-message Event.

### Plugin Model

Extensions are standard Cordis plugins. A plugin declares Service dependencies and registers tools, prompt contributions, context providers, event projectors, or Providers. Every registration is owned by the installing Cordis fiber and is removed when that fiber is disposed.

No parallel `AgentPlugin` abstraction is introduced. Tool and prompt registrations use root-global and Agent-scoped layers:

- Root registrations are global.
- Agent-scoped registrations shadow global entries with the same name.
- Duplicate names within one layer fail.
- Agent disposal removes only that Agent's scoped registrations.

## Lifecycle and Execution

### Create, Resume, and Dispose

Agent creation and restoration are rollback-covered transactions. On failure, the unpublished Session, Agent, scoped plugins, and registry entries are removed before they become publicly observable.

- `ctx.agents.create()` creates a new Session.
- `ctx.agents.resume()` restores an existing persisted Session.
- `agent.send(type, data)` accepts one external-input Session Event.
- `agent.cancel(cause)` aborts the active Turn without disposing the Agent.
- `agent.whenIdle()` resolves when the active Turn is fully closed and required checkpoints are complete.
- `AgentHandle.dispose()` is the only public teardown capability.

### Manual Step Loop

The Agent Loop, not AI SDK's multi-Step loop, owns Step progression. For every Step it:

1. appends `step/start`;
2. assembles the system prompt and dynamic context;
3. commits a changed context snapshot when needed;
4. derives the current model Surface;
5. captures model-facing Tool schemas and private executable definitions in a `request/header`;
6. calls AI SDK `streamText()`;
7. forwards native AI SDK stream parts internally;
8. persists the semantic Assistant Message and Tool Call intent;
9. waits for a durable checkpoint before Tool side effects;
10. executes Tool Calls sequentially and persists every result or normalized failure;
11. appends `step/end` in a finally boundary;
12. starts another Step only when completed Tool results require a continuation and the Turn limit permits it.

Every Agent requires a positive `maxSteps`. Reaching the limit closes the Turn with `{ kind: 'max-steps', limit }`.

## Persistence and Recovery

Persistence is optional. Installing `ctx.persist` establishes a root-wide policy that every new Session is durable; without it, new Sessions are memory-only. `resume()` always requires the Service.

`JsonlPersistence` is the first concrete Provider. It writes one `<session-id>.jsonl` file per Session with a tagged header followed by lossless-JSON Session Event envelopes.

Durable checkpoints are required:

- after input, Context Snapshot, and `request/header` are committed and before every model request;
- after Assistant Message and Tool Call intent are committed and before Tool execution;
- before another model Step begins after Tool Results;
- during Agent disposal and explicit flush.

Valid JSONL that ends in an open Turn is recoverable. Recovery synthesizes missing Tool failures and Step/Turn closers, then flushes the repair Events. It never reruns a Tool, and malformed or truncated records are rejected rather than repaired.

## Planned Package Contract

The package root is planned to export stable contracts, public Service classes, Session/Event/Surface types, Agent types, Cordis module augmentations, and small creation/id helpers.

Concrete replaceable Providers use explicit subpaths:

- `@yesimbot/harness-core/agent-loop` for the default Agent factory and loop;
- `@yesimbot/harness-core/persist/jsonl` for `JsonlPersistence`.

The planned internal layout is:

```text
src/
  index.ts
  agent/
    index.ts
    types.ts
  agent-loop/
    index.ts
    driver.ts
  session/
    index.ts
    types.ts
    surface.ts
  model-surface.ts
  tools.ts
  system-prompt.ts
  persist/
    index.ts
    jsonl.ts
    format.ts
  scope.ts
  id.ts
  json.ts
```

## Development

The repository is initialized with Yarn 4 and the `node-modules` linker.

```bash
corepack yarn install
corepack yarn typecheck
corepack yarn lint
corepack yarn test
corepack yarn build
corepack yarn format
```

The Harness core design and acceptance criteria are defined in [docs/design.md](./docs/design.md). Athena Runtime contracts are defined in [docs/athena-runtime-design.md](./docs/athena-runtime-design.md). Implementation should not move ahead of their confirmed decisions.

Developer-facing feature guides are available in [docs/features](./docs/features/README.md). The project's vision and ecosystem boundaries are described in [docs/vision.md](./docs/vision.md) and [docs/positioning.md](./docs/positioning.md).

## Roadmap

1. Land the first Cordis-based implementation and make the design's executable acceptance scenario pass.
2. Prove Service Definitions, the Agent Factory split, scoped layers, and deterministic JSONL restoration.
3. Confirm the stable kernel contracts before introducing a first-class Mode registry.
4. Add YesImBot-specific modes, World-style continuous modes, platform adapters, and WebUI layers only as plugins on top of those contracts.
5. Keep Koishi as an optional compatibility transport while the framework becomes the main composition root.

## Related Repositories

Athena Harness core is intentionally independent from the existing runtime implementation:

- `YesImBot` and its existing `@yesimbot/agent-runtime` implementation;
- Koishi plugin integrations;
- `pi-ai`;
- deepseek-harness and any deepseek-harness application framework.

It borrows selected architectural concepts from deepseek-harness's design, but it does not depend on its implementation or type system. The project's digital life vision is documented in [docs/vision.md](./docs/vision.md).
