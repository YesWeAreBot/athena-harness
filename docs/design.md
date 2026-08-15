# Athena Harness Design

## Status

The canonical architecture baseline is [architecture-foundation.md](./architecture-foundation.md). This document records the current Harness core prototype implementation and should not override that baseline.

Athena Runtime decisions live in [athena-runtime-design.md](./athena-runtime-design.md).

This is not an interface specification. Specific APIs and package boundaries remain subject to the canonical baseline.

## Purpose

Athena Harness core is a small, platform-agnostic agent-runtime toolkit built directly on Cordis and AI SDK. It serves Athena Runtime, the next YesImBot digital life framework, but it is not a compatibility layer around YesImBot's existing `@yesimbot/agent-runtime`.

The prototype validates whether Cordis can provide composable service dependencies and reversible lifecycle ownership without inheriting deepseek-harness's full application framework.

## Goals

- Use upstream Cordis v4 for plugin composition, service dependencies, effect ownership, and disposal.
- Use stable AI SDK v7 types and `streamText()` directly.
- Expose a stable `ctx.agents` registry and keep Agent definitions separate from the Agent Loop provider.
- Keep extensions dependent on stable Service Definitions rather than concrete Providers.
- Preserve structured, merge-extensible Session Events as durable facts.
- Derive AI SDK `ModelMessage[]` from the Session Event log without persisting external input as a pre-rendered `user/message` event.
- Validate tool registration, prompt assembly, dynamic context snapshots, Session persistence, restoration, and continuation.
- Keep the first implementation small enough to discard if its core assumptions fail.

## Non-goals

The first version does not provide:

- YesImBot or Koishi integration;
- compatibility with `@yesimbot/agent-runtime`, its plugins, types, or storage format;
- legacy data migration;
- `pi-ai` integration;
- a CLI framework, Cordis Loader, HMR, or bundle configuration;
- a top-level `createRuntime()` factory or one Cordis root per Agent;
- concurrent Turns within one Agent, Turn queues, join, or defer semantics;
- subagents, compaction, sandbox policy frameworks, approval pipelines, or tool schedulers;
- a custom LLM protocol or a second message type system over AI SDK;
- a runtime `InvariantRegistry` service.

## Layered Boundary

Athena Harness core is the agent-runtime toolkit. Athena Runtime is the digital life framework layer and the next YesImBot core.

This document describes Harness core only. Life, Mode, Body, Percept, Actuator, and Athena Runtime Memory contracts are defined in [athena-runtime-design.md](./athena-runtime-design.md).

Harness core does not implement Mode behavior. It provides the reusable execution components that Athena Runtime and Mode consumers can use.

The repository is a Yarn workspaces monorepo with `@yesimbot/harness-core` and `@yesimbot/athena-runtime`. Future `mode-chat`, `mode-world`, `adapter-*`, or `plugin-*` packages will be added under `packages/*`.

## Repository

- Repository: `/home/workspace/athena-harness`
- Packages: `@yesimbot/harness-core`, `@yesimbot/athena-runtime`
- Topology: Yarn workspaces monorepo
- Package manager: Yarn 4 with the `node-modules` linker
- Publication remains disabled while the package is an architecture prototype.

Providers and validation plugins remain internal modules until independent consumers prove that further package splits are necessary.

`@yesimbot/harness-core` keeps `agent` and `agent-loop` as separate internal modules: the former owns stable contracts and `ctx.agents`, while the latter provides the concrete Agent factory and loop.

## Design Basis

Athena Harness adopts selected deepseek-harness concepts rather than its implementation or complete type system:

- append-only Session Event logs;
- declaration-mergeable event vocabularies;
- deterministic derivation of model messages from durable events;
- request snapshots that describe the actual model call;
- package-owned Cordis effects and reversible registrations;
- explicit Service Definition and Provider separation;
- an Agent Registry whose concrete Agent Loop is installed through a replaceable factory slot;
- owner-only Agent Handles for lifecycle teardown.

It deliberately uses AI SDK's model, message, tool, and stream types instead of deepseek-harness's custom LLM algebra.

## Position Relative to Deepseek Harness

Athena Harness corresponds to deepseek-harness's **core Service kernel plus one default Agent Runtime Provider**, with a narrow persistence Provider included for validation. It is not equivalent to `dsh-agent-loop` alone and does not include DSH's application, bundle, loader, or product-plugin layers.

```text
DSH application / host / CLI / web / bundle       not included
DSH optional product-plugin ecosystem              not included
DSH core Service Definitions                       included in package root
DSH agent-loop Provider                            included at ./agent-loop
DSH persistence Definition + JSONL + sync policy   reduced into ctx.persist + ./persist/jsonl
DSH LLM Runtime + adapters                         replaced by direct AI SDK LanguageModel/streamText
DSH Cordis fork                                    replaced by upstream Cordis dependency
```

The closest source-package mapping is:

| Athena Harness area                           | Closest DSH area                                                                                   | Relationship                                                                           |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| package-root Agent contracts and `ctx.agents` | `dsh-agent`                                                                                        | Same Registry/Factory/owner-handle role, reduced API.                                  |
| `ctx.sessions` and Session Event log          | `dsh-session`                                                                                      | Same durable event-log and unpublished Session transaction direction.                  |
| `ctx.tools`                                   | `dsh-tools`                                                                                        | Same registration/layer role, without policy, scheduler, approval, or subcall systems. |
| `ctx.systemPrompt`                            | `dsh-system-prompt` plus Agent Loop runtime-context projection                                     | Reduced named sections and dynamic Context snapshots.                                  |
| `./agent-loop`                                | `dsh-agent-loop`                                                                                   | Same concrete `AgentFactory` Provider role, but invokes AI SDK directly.               |
| `ctx.persist` and `./persist/jsonl`           | `dsh-session-persistence`, persistence sync/checkpoint policy, and `dsh-session-persistence-jsonl` | Collapsed minimum durable subset.                                                      |
| `ctx.modelSurface`                            | no direct DSH Service equivalent                                                                   | New extension seam; DSH keeps fixed model-Surface projection inside Session Core.      |

Architecturally, the package is therefore a **minimal harness SDK/kernel**. The embedding application still owns the Cordis root and composition; an application layer could later install Athena Services, Providers, and feature plugins, but that layer is outside this package's first version.

## Service Topology

Core registry-style Services are public concrete Cordis `Service` classes, matching deepseek-harness's `AgentRegistry`, `SessionStore`, and `LlmRuntime` pattern. Their public class shape is the stable contract used by plugins; Provider-specific implementation classes such as the Agent Loop or JSONL backend are not part of those plugin dependencies.

The first-version root services are:

| Context key        | Public service  | Responsibility                                                                                                 |
| ------------------ | --------------- | -------------------------------------------------------------------------------------------------------------- |
| `ctx.agents`       | `AgentRegistry` | Multi-Agent creation, restoration, lookup, ownership, and the registered `AgentFactory` slot.                  |
| `ctx.sessions`     | `SessionStore`  | Live Session preparation, publication, lookup, and removal. It does not own model projection.                  |
| `ctx.modelSurface` | `ModelSurface`  | Root-global Event-to-model projection and deterministic AI SDK `ModelMessage[]` derivation.                    |
| `ctx.tools`        | `ToolRuntime`   | Root and Agent-scoped AI SDK Tool registration, shadowing, and immutable per-Step composition.                 |
| `ctx.systemPrompt` | `SystemPrompt`  | Root and Agent-scoped static prompt sections and dynamic runtime-context contributions.                        |
| `ctx.persist`      | `Persistence`   | Optional durable Session preparation, append, flush, and restoration. The JSONL backend is the first Provider. |

`agent-loop` is not a public Service. It is a concrete Agent-factory plugin that injects `agents`, `sessions`, `modelSurface`, `tools`, and `systemPrompt`, then registers its factory through `ctx.agents.setFactory()`. Restoring a Session additionally requires `persist`.

No model Service exists in the first version: each Agent owns the live AI SDK `LanguageModel` passed at creation or restoration.

`AgentRegistry`, `SessionStore`, `ModelSurface`, tools, and system-prompt use public concrete Service classes. A separate abstract Definition is reserved for a backend seam only if the persistence design proves multiple Providers are required.

## Domain Model

### Harness Root

The embedding application owns one Cordis v4 root Context. Athena Harness installs its stable Services and Providers into that root. The package does not expose a top-level `createRuntime()` abstraction.

One root may host multiple live Agents. Root disposal tears down every Agent before their shared Providers disappear.

### Agent Registry

`ctx.agents` is the stable multi-Agent Service Definition. It tracks live Agents and exposes creation, restoration, and lookup. It does not implement the model loop itself.

The `agent` module owns Agent contracts, `AgentHandle`, `AgentFactory`, and the registry. The `agent-loop` module provides the concrete factory through an effect-scoped registration. Consumers depend on `agent`, not on `agent-loop`.

### Agent Handle

Agent creation and restoration return an owner capability containing the live Agent and its disposer. Only the owner receives the disposer; registry lookup returns a non-owning Agent reference.

Each Agent directly owns the AI SDK `LanguageModel` capability supplied during creation or restoration. The first version does not publish `ctx.models` or a DSH-style `ctx.llm` Service.

### Agent

An Agent is one live execution driver with one scoped Cordis context and one or more Sessions. Multiple Agents may run independently under the same root, while each Agent permits at most one active Turn in the first version.

Creation and restoration accept an optional `setup(agentCtx)` callback. `AgentContext` exposes the Agent id, its Cordis scope, scoped tool/prompt/user-projector registration, and ordinary Cordis plugin installation. Contributions made through `AgentContext` are removed when the Agent is disposed.

The Agent control and event APIs are specified in [Public API and Modules](#public-api-and-modules).

### Session

A Session is one Agent's durable source of truth:

- one header;
- an append-only sequence of Session Events;
- deterministic Surface derivation;
- JSONL persistence and restoration.

An Agent is temporary. A Session can be restored into a newly composed Agent after the previous Agent is disposed.

`SessionStore` remains a Session lifecycle and publication Service. Neither `SessionStore` nor a `Session` owns model-Surface projector registration.

### Turn

A Turn is one accepted external input followed by zero or more model Steps and one final outcome. Only one Turn may be active per Agent in the first version. Submitting to a busy Agent fails with an explicit busy error.

### Step

A Step is one AI SDK model call and the tool activity produced by that call. Tool results may cause another Step in the same Turn.

### Session Event

Session Events are the only durable execution records. Their discriminated union is extended through TypeScript declaration merging.

Custom events retain their complete structured data in the Session log. A custom event may remain log-only or register a pure projector that derives a model-visible user message.

### Model Surface

The model Surface is closed to four semantic categories:

- `user/message`;
- `assistant/message`;
- `tool/result`;
- `context/snapshot`, projected as a `user/message` containing the rendered dynamic context.

The Session Event vocabulary is open; the model Surface algebra is closed. Custom Session Events may project to `user/message`, but the derived user message is not separately persisted as a `user/message` Session Event.

The first version does not permit extensions to synthesize `assistant/message` or `tool/result` Surface nodes.

### Plugin

Extensions are standard Cordis plugins. A plugin declares Service dependencies and registers tools, prompt contributions, context providers, event projectors, or Providers. Every registration is owned by the installing Cordis fiber and is removed when that fiber is disposed.

No parallel `AgentPlugin` abstraction is introduced.

### Service Definition and Provider

A Service Definition is a stable contract imported by consumers and extension plugins. A Provider implements that Definition. Definitions never import Providers, and extension plugins do not depend on Provider classes.

## Lifecycle

### Root Composition

The embedding application creates the Cordis root and explicitly installs Athena Harness Services and Providers. No bootstrap helper hides the root or installs a default composition.

### Agent Creation and Restoration

Agent creation is one rollback-covered transaction:

1. the owner calls `ctx.agents.create()` or `ctx.agents.resume()`;
2. the registry delegates through the currently registered `AgentFactory` using the caller's Context as the ownership boundary;
3. the factory prepares a new or restored Session without publishing it;
4. the factory creates the Agent's scoped Cordis world;
5. scoped plugins register tools, prompt contributions, context providers, and event projectors;
6. the factory rebuilds and validates the Session Surface;
7. the Session and Agent are entered and announced in order;
8. the loop starts only after publication succeeds;
9. the owner receives an `AgentHandle`.

Plugins and event projectors must be installed before restoration. A required custom event without its projector causes restoration to fail.

Failure at any step rolls back the unpublished Session, Agent, scoped plugins, and registry entries. Neither id remains publicly observable after rollback completes.

### Execution

Each Agent executes one Turn at a time:

1. reject input when the Agent is stopping, disposed, or already busy;
2. persist the structured input Session Event;
3. append `turn/start`;
4. run one or more Steps using AI SDK `streamText()`;
5. persist semantic assistant and tool records;
6. append `turn/end`;
7. return the Agent to idle.

The Agent Loop owns Session commit timing, request snapshots, context snapshots, and stream-to-event translation. AI SDK owns provider-neutral model invocation and tool calling.

### Agent Disposal

Disposing an `AgentHandle`:

1. prevents new input for that Agent;
2. aborts its active AI SDK call and tool execution;
3. waits for the active Turn to exit;
4. flushes its Session persistence;
5. unregisters the Agent;
6. removes and closes its Session;
7. disposes its scoped Cordis world.

Disposal is idempotent. Cleanup continues after an individual cleanup failure while preserving the primary error. Restoration creates a new Agent and Handle.

Root disposal first stops and drains every Agent created by the active Agent factory, then disposes shared Providers.

## AI SDK Boundary

- Target stable AI SDK v7.
- Resolve no additional model abstraction: the Agent Loop passes the Agent's `LanguageModel` directly to `streamText()`.
- Persist only serializable provider/model identity in `request/header`; restoration requires the caller to supply the live `LanguageModel` again.
- Use AI SDK `LanguageModel`, `ModelMessage`, `ToolSet`, and stream-part types directly.
- Use `streamText()` rather than `ToolLoopAgent` in the first version so Session commit and request-snapshot boundaries remain explicit.
- Publish native AI SDK stream parts on the internal Cordis event stream.
- Expose a smaller Agent/Harness-owned event vocabulary to external consumers.
- Persist semantic Session Events, not token-level AI SDK stream parts, in the first version.

External Agent output is limited to displayable text deltas and final Assistant Messages; the detailed routing is specified in [Agent Events](#agent-events).

## Prompt, Tools, and Agent Loop

### Scoped Composition

`ToolRuntime` and `SystemPrompt` use DSH-style layered composition. Registrations made from the Harness root enter the global layer; registrations made from an Agent-scoped Context enter that Agent's layer. A scoped entry shadows a global entry with the same name, while duplicates within one layer fail.

Agent disposal removes every scoped registration through Cordis effects without affecting global entries or another Agent's layer. Descendant plugin Contexts inherit the owning Agent scope.

### Tools

`ctx.tools` is a concrete `ToolRuntime` Service. Plugins register a name and an AI SDK Tool definition and receive the exact disposer. The Service does not introduce a second Tool schema or execution protocol.

At the beginning of each Step, the Agent Loop obtains a fresh immutable tool snapshot for that Agent. The snapshot separates model-facing AI SDK schemas from the captured `execute` capabilities. Scoped tools shadow globals by name. Registration or disposal affects later Steps, never the definitions already captured by an active Step.

AI SDK receives schema-only Tools and is responsible for provider formatting plus typed Tool Call parsing. It does not invoke `execute`. After the model Step completes, the Agent Loop persists the complete Assistant Message and Tool Call intents, waits for a durable checkpoint, and only then asks `ToolRuntime` to execute calls sequentially with the active Agent abort signal. Each result or normalized execution failure is persisted before another model Step begins.

This ordering cannot make arbitrary Tool side effects exactly-once, but it guarantees that durable intent exists before the side effect starts. The first version does not implement restrictions, approval, presentation modes, schedulers, parallel calls, subcalls, or a code-mode transport.

`ToolRuntime` does not inject `SystemPrompt`: AI SDK receives Tool schemas through `streamText({ tools })`, and the durable `request/header` records their serializable schema snapshot separately from the rendered system prompt.

### System Prompt and Dynamic Context

`ctx.systemPrompt` is a concrete `SystemPrompt` Service. It supports named, ordered static sections and named, ordered dynamic Context providers. Scoped entries shadow globals by name. The first version has no template language, prompt variables, complete-prompt replacement, or tool-schema providers.

Assembly returns two separate immutable products:

- one rendered system string from static sections;
- one structured dynamic-context snapshot from Context providers.

Static system content is captured in `request/header`. Dynamic context is declaration-merged by the system-prompt module as a structured `context/snapshot` Session Event with the rendered text and contributing section metadata. Its root-global `ctx.modelSurface` projector derives a `user/message` without persisting a separate user-message Event.

An Agent-owned runtime-context tracker appends a snapshot only when the rendered value changes. Transitioning from non-empty context to empty context appends an explicit clearing snapshot so older context cannot remain semantically active. Historical snapshot Events remain immutable.

### Manual Step Loop

The Agent Loop, not AI SDK's multi-Step loop, owns Step progression. One Turn may call `streamText()` multiple times, exactly once per Step. Each call is explicitly limited to one AI SDK Step while retaining AI SDK Tool execution inside that Step.

For every Step, the Agent Loop:

1. appends `step/start`;
2. assembles system prompt and dynamic context;
3. commits a changed context snapshot when needed;
4. derives the current model Surface through `ctx.modelSurface`;
5. captures the Agent's model-facing Tool schemas and private executable definitions, then builds `request/header`;
6. calls AI SDK `streamText()` with the Agent's `LanguageModel`, messages, system, schema-only tools, and abort signal;
7. forwards native AI SDK stream parts on the internal event stream;
8. persists the semantic Assistant Message and every Tool Call intent;
9. waits for `ctx.persist` when the Agent is durable, establishing a checkpoint before Tool side effects;
10. executes Tool Calls sequentially through `ToolRuntime` and persists every Tool Result or normalized failure with an explicit `ok` / `error` status;
11. appends `step/end` in a finally boundary;
12. starts another Step only when completed Tool results require a model continuation and the Turn limit permits it.

When no continuation is required, or a stop condition is reached, the Agent Loop appends `turn/end`. Tool and model errors must still close every opened Step and Turn boundary.

Every Agent requires a positive integer `maxSteps`. The loop refuses to open another Step after reaching the limit and ends the Turn with `{ kind: 'max-steps', limit }`.

`TurnEndReasonMap` is declaration-mergeable and initially contains:

- `completed` when the final Step requires no continuation;
- `aborted` with a structured cancellation cause;
- `error` with a lossless-JSON error record;
- `max-tokens` when AI SDK reports an output-token limit;
- `max-steps` with the configured limit;
- `interrupted`, synthesized only when persistence restores a crash-orphaned open Turn.

`assistant/message` stores the AI SDK Assistant Model Message plus Turn, Step, and usage metadata. `tool/call` stores the corresponding AI SDK `ToolCallPart` plus Turn and Step. Each `tool/result` stores one AI SDK Tool Model Message containing the result or normalized error for one call plus an explicit `ok`, `error`, or `interrupted` status. Every persisted payload must pass lossless-JSON validation; provider metadata that cannot pass is rejected rather than silently removed.

## Session Events and Model Surface

### Built-in Event Vocabulary

The first Session format keeps the minimum DSH lifecycle and semantic events:

- `turn/start` and `turn/end`;
- `step/start` and `step/end`;
- `user/message`;
- `assistant/message`;
- `tool/call` and `tool/result`;
- `request/header`.

AI SDK stream parts remain live internal events and are not persisted as `assistant/chunk`. Todo state, provider-route context, seed-boundary markers, and other DSH application events are not built in; plugins may declaration-merge their own log-only events.

`SessionEventMap` is declaration-mergeable. A committed event envelope contains its discriminant, contiguous `seq`, epoch-millisecond `time`, deeply frozen lossless-JSON `data`, and optional `ignorable`, `surfaceOp`, and `sourceEventSeqs` fields. `Session` assigns `seq` and `time`; callers provide only the event type, data, and valid surface intent.

Unknown required events reject restoration. Unknown `ignorable: true` events may remain in the log only when they do not carry model-Surface intent.

### Surface Topology

Athena Harness implements the complete DSH `SurfaceOp` algebra in the first format:

```text
'append'
| { op: 'replace', start: number, end: number }
```

`sourceEventSeqs` records the complete known source-event set for derived and replacing nodes. A replacement must cite every shadowed Surface node and refer to an existing inclusive range.

Each `Session` owns a structural `SurfaceManager`, matching DSH. It validates and incrementally folds `surfaceOp` into ordered event-sequence nodes and a replacement generation. This is log topology, not projector registration or model-message rendering; `SessionStore` remains responsible only for Session lifecycle and publication.

Model-visible built-in events require a valid `surfaceOp`; built-in lifecycle and trace events forbid one. A custom event may carry Surface intent only when the root-global `ctx.modelSurface` has a projector for its type.

### Model Projection

A custom Session Event may register a pure projector:

```text
custom Session Event
  -> derived user/message Surface node
  -> AI SDK UserModelMessage
```

Projection requirements:

- the durable event remains unchanged;
- projectors receive frozen events;
- projectors are synchronous and cannot read time, network state, or mutable Provider state;
- repeated projection of the same event under the same root composition is deterministic;
- events without Surface intent remain log-only;
- a Surface event without its required projector prevents restoration and model calls.

`ctx.modelSurface` is a stable concrete Cordis Service separate from `SessionStore`, `Session`, and the Agent Loop. It owns built-in event-to-message projection, root-global custom user-projector registration, and deterministic AI SDK `ModelMessage[]` derivation over `session.surface.nodes`.

Its minimum public operations are conceptually:

- effect-scoped registration of one unique custom Event Type to a user-message projector;
- projection of one Surface Event to an AI SDK message or no message;
- derivation of a fresh `ModelMessage[]` snapshot for one Session.

Custom projectors may only derive `user/message`; `assistant/message` and `tool/result` remain Core-owned. Duplicate registrations fail. Removing a projector makes any live or restored Session that requires it fail on its next validation or derivation.

Deepseek-harness's separate `SessionProjectionRegistry` folds events into domain read models such as Todo or Goal state. It is not a model-Surface projector, and Athena Harness does not reuse it for `ctx.modelSurface`.

## Persistence

### Service and Provider Boundary

`ctx.persist` is optional. Its stable Definition is an abstract `Persistence` Cordis Service; `JsonlPersistence` is the first concrete Provider. New in-memory Agents do not require the Service. Durable Agent creation and every restoration path do.

The minimum public backend operations are conceptually:

- create one immutable Session header;
- append one contiguous batch of committed Session Events;
- prepare one exclusively reserved unpublished Session for restoration;
- open an existing prepared Session as a live binding for continuation;
- flush one Session's queued writes through a durable media synchronization boundary;
- close and release one active Session binding.

The Agent factory owns the live binding between a Session and `Persistence`. Session append remains synchronous and commits frozen Events to memory; the binding observes those commits and serializes backend appends through one per-Session promise tail.

### JSONL Format v0

Each materialized Session uses one `<session-id>.jsonl` file under the configured persistence root. The first line is a tagged header:

```json
{ "type": "session", "version": 0, "id": "...", "createdAt": 0 }
```

Every following line is the exact lossless-JSON Session Event envelope, including `seq`, `time`, `data`, and any `ignorable`, `surfaceOp`, or `sourceEventSeqs` fields. Files end on newline boundaries. Creation uses an exclusive atomic create so an existing identity is never overwritten.

Version `0` accepts no migration. A different version, invalid header identity, sequence gap, invalid Surface replacement, malformed JSON, or truncated final record rejects restoration with the Session id and physical line number.

Custom log-only events must be persisted as `ignorable: true`. Custom required model-visible events carry Surface intent and require their root-global `ctx.modelSurface` projector. The first version does not add a second runtime Event-Type Registry.

The Provider supports multiple live Sessions in one process but not concurrent writers from multiple processes. One Session id may have only one live or preparing owner in the Harness root.

### Durable Checkpoints

Backend append is queued, but external side effects do not cross an unflushed boundary. A durable Agent awaits `ctx.persist` and performs media synchronization:

- after input, Context Snapshot, and `request/header` are committed and before every model request;
- after Assistant Message and Tool Call intent are committed and before Tool execution;
- before another model Step begins after Tool Results;
- during Agent disposal and explicit flush.

For the JSONL Provider, successful flush includes waiting for the per-Session write tail and synchronizing the open file handle. A failed checkpoint prevents the next model or Tool side effect and ends the Turn with a persisted error when the backend remains writable.

### Crash Recovery

Valid JSONL that ends in an open Turn is recoverable. `prepare()` validates the committed prefix, synthesizes lossless-JSON error Tool Results for every durable Tool Call without a result, appends a missing `step/end`, and appends `turn/end` with `{ kind: 'interrupted' }`. It durably flushes those repair Events before returning the unpublished Session preparation.

Malformed or truncated physical records are not repaired. Recovery never reruns a Tool. A Tool side effect may have occurred before a process crash even when no result was recorded; the synthesized error reports an unknown interrupted outcome rather than claiming the Tool did not run.

The first version does not provide listing, search, raw-artifact APIs, suffix reads, compression, write batching across Sessions, fork lineage, migration chains, or cross-process coordination.

## Public API and Modules

### Root Composition

The package does not export `createRuntime()` or a default Core bundle. The embedding application creates the Cordis root and explicitly installs the concrete Services and Providers it wants. This keeps replacement and lifecycle behavior visible in the composition.

Installing `ctx.persist` establishes one root-wide policy: every subsequently created Session is durable. Without the Service, new Sessions are memory-only. `resume()` always requires the Service.

### Agent Registry API

The stable `AgentRegistry` public surface conceptually provides:

- effect-scoped registration of exactly one `AgentFactory`;
- asynchronous `create()` and `resume()` operations;
- non-owning lookup and immutable listing of live Agents;
- owner-only `AgentHandle` disposal.

Creation requires a Session id, AI SDK `LanguageModel`, positive `maxSteps`, and optional `setup(agentCtx)` callback. Restoration requires the same live composition plus the persisted Session id. Setup runs against the unpublished Agent-scoped Context and may install ordinary Cordis plugins, tools, prompt sections, dynamic context providers, and user projectors; no Athena-specific Plugin descriptor array is introduced.

The caller Context and active Agent-factory Provider structurally co-own each returned handle. Caller or factory disposal reaches the same memoized Agent quiescence boundary. Concurrent create/resume operations for one Session id may prepare privately, but only one may enter the registries; every loser rolls back without publication.

### Agent API

A live Agent exposes its id, `primarySession`, `sessions`, `getSession(id)`, AI SDK model, current `idle | running` status, and configured `maxSteps`.

`agent.send(type, data)` synchronously accepts one external-input Session Event and wakes the Agent. It permits the built-in `user/message` type or a custom Event Type with a registered root-global or Agent-scoped user projector; lifecycle, assistant, and tool event types are rejected. Sending while running, stopping, or disposed throws synchronously.

`agent.cancel(cause)` aborts the active Turn without disposing the Agent. `agent.whenIdle()` resolves when the active driver has fully closed its Step/Turn, completed required persistence checkpoints, and returned to idle. `AgentHandle.dispose()` is the only public teardown capability.

### Agent Events

Agent observation uses declaration-merged Cordis events and a subject-bound `agentEvents(ctx, agent)` helper, following DSH. Athena Harness does not maintain an additional EventTarget or AsyncIterable listener system.

The first built-in Agent events are:

- `agent/status` for non-repeating idle/running transitions;
- `agent/error` with Agent, Turn, Step when known, and the original live error;
- internal `agent/stream-part` carrying the native AI SDK v7 stream part;
- external `agent/output` carrying either a displayable `text-delta` or the final AI SDK Assistant Message.

Tool, Turn, Step, request, and persistence facts are observed through `session/event`, not mirrored onto `agent/output`.

### Package Exports

The package root exports stable contracts, public Service classes, Session/Event/Surface types, Agent types, Cordis module augmentations, and small creation/id helpers.

Concrete replaceable Providers use explicit subpaths:

- `@yesimbot/harness-core/agent-loop` for the default Agent factory and loop;
- `@yesimbot/harness-core/persist/jsonl` for `JsonlPersistence`.

The package does not expose every internal directory as a public subpath.

### Initial Internal Layout

```text
packages/
  harness-core/
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
      freeze.ts
    test/
```

Athena Runtime layout is documented in `docs/athena-runtime-design.md`.

`agent`, `agent-loop`, `session`, and `persist` begin as directories because they already have distinct stable contracts and implementation responsibilities. Smaller Services stay single files until their implementations require another cohesive unit.

## Invariants

System invariants are required; an `InvariantRegistry` service is not part of the first version.

Always-on Service boundaries own data integrity and safety checks, including:

- Session serialization, cloning, freezing, sequencing, and restore validation;
- projector output validation;
- persistence identity and format checks;
- file-tool path containment and error handling.

Cross-Service and cross-time relations are executable architecture tests, including:

- the model request messages equal `ctx.modelSurface.deriveMessages(session)`;
- restored messages equal the pre-stop messages;
- every tool result has a corresponding tool call;
- the actual model, system prompt, and tool schemas match the durable request snapshot;
- Cordis disposal removes every registered contribution exactly once.

An optional DSH-style package-owned invariant service may be introduced later if independently deployed extension packages and variable plugin compositions create failures that local tests cannot diagnose.

## Prototype Acceptance

The prototype is accepted only when one deterministic executable scenario proves the complete architecture, supported by focused tests for failure boundaries.

### Composition and Lifecycle

- Explicitly install all required Services and the default Agent Loop into one Cordis root.
- Register one root-global Tool and Prompt contribution.
- Create two Agents with different fake AI SDK models and Agent-scoped overrides.
- Prove scoped shadowing, Session isolation, owner-bound handles, same-id race rollback, and factory replacement cleanup.
- Dispose one Agent without changing the other's tools, prompt, status, or Session.
- Dispose the root and prove every Agent, listener, registration, file handle, and pending driver reaches quiescence exactly once.

### Session and Model Surface

- Declaration-merge `external/message`, persist its structured source data, and project it to `user/message` without writing a duplicate user-message Event.
- Exercise Surface append and an inclusive replace with complete `sourceEventSeqs`.
- Prove the actual model request messages equal `ctx.modelSurface.deriveMessages(session)`.
- Prove log-only ignorable Events survive persistence but do not enter the model Surface.
- Prove a missing required custom projector rejects restoration and later derivation.

### Prompt, Context, and Tools

- Assemble global and Agent-scoped static prompt sections in deterministic order.
- Persist a structured dynamic Context Snapshot only when changed and append an explicit clear snapshot.
- Run one Turn in which the fake model calls `read_file`, then `write_file`, then returns final text across multiple manually driven Steps.
- Prove Assistant/Tool Call intent is durable before either file Tool executes.
- Prove the next model request includes the persisted Tool Result and exact request header.
- Reach `max-steps` with a looping fake model and close the Turn without opening another Step.

### Persistence and Recovery

- Create, checkpoint, stop, restore, and continue one JSONL Session with identical pre-stop and post-restore model messages.
- Simulate a crash after a durable Tool Call and prove recovery writes an unknown-outcome Tool failure plus Step/Turn interruption closers without rerunning the Tool.
- Reject wrong versions, identity mismatches, sequence gaps, invalid Surface replacements, malformed JSON, and truncated final records.
- Prove checkpoints fail before a model or Tool side effect when the backend write or file synchronization fails.

### Public Package Contract

- Type-check a consumer that imports stable Services and types only from `@yesimbot/harness-core`.
- Type-check Provider installation from `@yesimbot/harness-core/agent-loop` and `@yesimbot/harness-core/persist/jsonl`.
- Prove an extension plugin imports no concrete Provider.
- Keep production runtime dependencies limited to Cordis and AI SDK unless a new dependency is separately justified.
- Keep the implementation free of YesImBot, Koishi, `@yesimbot/agent-runtime`, `pi-ai`, and deepseek-harness imports.

## Continue and Stop Conditions

Continue beyond the prototype only if:

- upstream Cordis v4 requires no local lifecycle patch;
- AI SDK v7 can supply schema-only Tools while the Agent Loop executes captured capabilities after a durable checkpoint;
- the same Session prefix deterministically reconstructs the same AI SDK messages after restoration;
- Agent-scoped layers dispose without leaking into another Agent;
- extensions depend only on stable public Services and Cordis events.

Stop or redesign before adding more features if:

- correct disposal requires copying deepseek-harness's patched Cordis fork;
- model invocation requires a custom LLM, Message, Tool, or Stream algebra over AI SDK;
- multi-Agent scoping requires importing DSH's full Scope/Layer framework rather than a small local mechanism;
- JSONL correctness requires its coordinator, revision, compression, search, or migration subsystems;
- model-visible custom Events cannot be restored deterministically without persisting a second pre-rendered user-message Event;
- Tool intent cannot be made durable before Tool execution with AI SDK v7's schema-only call path.

Implementation may choose exact helper names and local data structures, but it may not change the public responsibilities, event ordering, lifecycle ownership, or persistence guarantees in this document without another explicit design decision.

## Confirmed Decisions

- 2026-08-14: choose a new implementation based on Cordis rather than trimming deepseek-harness.
- 2026-08-14: create an independent, platform-neutral harness with no YesImBot integration in the first version.
- 2026-08-14: do not reuse or remain compatible with `@yesimbot/agent-runtime`.
- 2026-08-14: use DSH-style Session Events and persistence concepts while using AI SDK types directly.
- 2026-08-14: keep the model Surface closed to user, assistant, and tool-result categories.
- 2026-08-14: expose native AI SDK stream parts internally and Agent/Harness-owned events externally.
- 2026-08-14: keep runtime invariants as always-on boundary checks and executable tests rather than implementing an Invariant Service initially.
- 2026-08-14: preserve DSH's `agent` / `agent-loop` split, expose `ctx.agents`, and retain a multi-Agent Registry.
- 2026-08-14: do not introduce a top-level `createRuntime()` abstraction.
- 2026-08-14: keep `SessionStore` focused on Session lifecycle and logs; it does not own Surface or Projector registration.
- 2026-08-14: expose a separate root-global `ctx.modelSurface` Service for deterministic Event-to-model projection.
- 2026-08-14: let each Agent directly own its AI SDK `LanguageModel`; do not add a Model Registry or LLM Service in the first version.
- 2026-08-14: use public concrete Cordis Service classes for core registries; extensions depend on those stable classes, not Agent Loop or backend implementation classes.
- 2026-08-14: make Session persistence optional; publish it as `ctx.persist` with public Service class `Persistence`. New in-memory Agents do not require it, while restoration does.
- 2026-08-14: name the repository `athena-harness`; the original single-package topology was superseded by the 2026-08-15 monorepo decision.
- 2026-08-14: persist the minimum DSH lifecycle event set and omit token-level assistant chunks from Session format v0.
- 2026-08-14: implement complete DSH `SurfaceOp` append/replace semantics and `sourceEventSeqs` in the first format.
- 2026-08-14: let each Session own structural Surface topology while root-global `ctx.modelSurface` owns event-to-message projection.
- 2026-08-14: compose Tools, prompt sections, and dynamic Context through root-global and Agent-scoped layers with scoped shadowing.
- 2026-08-14: let the Agent Loop drive one AI SDK `streamText()` call per Step; do not delegate the multi-Step Tool Loop to AI SDK.
- 2026-08-14: require a positive per-Agent `maxSteps` and persist `max-steps` as a Turn end reason when the manual Tool Loop reaches it.
- 2026-08-14: keep Tool execution in the Agent Loop; persist and checkpoint Assistant/Tool Call intent before invoking Tool side effects.
- 2026-08-14: define abstract `ctx.persist` / `Persistence` and provide JSONL through `JsonlPersistence`.
- 2026-08-14: keep Session append synchronous but require durable checkpoints before model calls, Tool side effects, later Steps, and Agent disposal.
- 2026-08-14: recover a valid crash-orphaned Turn by durably synthesizing missing Tool failures and Step/Turn closers; reject malformed or truncated records.
- 2026-08-14: install Services and Providers explicitly into an application-owned Cordis root; provide no default Core bundle.
- 2026-08-14: install Agent-scoped plugins through an unpublished async `setup(agentCtx)` callback.
- 2026-08-14: accept external input through `agent.send(type, data)` as a permitted Session Event rather than only an AI SDK User Message.
- 2026-08-14: when `ctx.persist` is installed, make every new Session in that root durable; without it, new Sessions are memory-only.
- 2026-08-14: export stable contracts from the package root and concrete Providers only through `./agent-loop` and `./persist/jsonl`.
- 2026-08-14: use Cordis `agentEvents(ctx, agent)` observation, with public output limited to text deltas and final Assistant Messages.
- 2026-08-15: after prototype acceptance, evolve the harness into a mode-oriented Cordis framework; Chat, World, and community modes are plugins and Koishi is an optional transport adapter.
- 2026-08-15: the first prototype remains kernel-only and does not implement the Mode registry, transport adapters, mode packages, or a separate WebUI.
- 2026-08-15: use a Yarn workspaces monorepo with `@yesimbot/harness-core` and `@yesimbot/athena-runtime`; future mode, adapter, and plugin packages will be added under `packages/*`.
- 2026-08-15: Athena Runtime contracts, including Body, Percept, Life, and Mode decisions, are tracked in `docs/athena-runtime-design.md`.
- 2026-08-15: model provider and model hot-switching is a target capability; the current one-`LanguageModel`-per-Agent design is a temporary simplification, not the long-term architecture.
- 2026-08-15: auxiliary models and perception pipelines belong to Mode/Body plugins; the prototype kernel does not implement them.
- 2026-08-15: durable `resume()` uses `prepare()` plus `open()`; the restored Session is published through `SessionStore.restore()` and continues with a live binding.
- 2026-08-15: Athena Runtime is a separate design domain from Harness core and is documented in `docs/athena-runtime-design.md`.
