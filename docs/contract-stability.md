# Contract Stability

## Status

Athena Harness Core is entering its first contract-freeze phase. The public surface below is treated as stable for the remaining prototype work; changes to it require an explicit compatibility review and migration note.

## Athena Runtime Status

Athena Runtime is still before contract freeze. The following APIs are experimental and may change:

- `Life`, `LifeHandle`, `LifeRegistry`
- `Mode`, `ModeHandle`, `ModeContext`, `ModeRegistry`
- `Body`, `BodyAdapter`, `BodyRegistry`, `PerceptEvent`, `Actuator`
- `LifeMemory`, `InMemoryMemory`, `JsonlMemory`
- `Scheduler`, `SchedulerRegistry`
- `AgentLoopProvider`, `AgentLoopRegistry`

These contracts have implementation and tests, but they are not stable yet. Breaking changes do not
require a major version bump until the Athena Runtime freeze is announced.

## Stable Public Surface

- Package root exports from `@yesimbot/harness-core`.
- Concrete subpaths `@yesimbot/harness-core/agent-loop` and `@yesimbot/harness-core/persist/jsonl`.
- Cordis service keys `agents`, `sessions`, `modelSurface`, `tools`, `systemPrompt`, and `persist`.
- `Agent`, `AgentHandle`, `AgentFactory`, `AgentContext`, `AgentStatus`, and Agent creation/restoration inputs.
- Session Event vocabulary, event envelopes, Surface semantics, and JSONL v0 persisted format.
- `TurnEndReason` values produced by the default Agent Loop.
- `agentEvents(ctx, agent)` observer surface.

## Compatibility Policy

Additive changes are preferred and may be introduced in minor iterations. Breaking changes require:

- a major version bump once the package is publishable;
- a migration section in the release notes or migration guide;
- updated feature guides and the executable acceptance tests;
- a PR that keeps the public contract typecheck and CI green.

Provider internals are not frozen. The Agent Loop implementation and JSONL backend may change as long as their documented contract and persisted behavior remain compatible.

## CI Gate

Every push to `main` and every pull request must pass:

- `yarn build`
- `yarn typecheck`
- `yarn test`
- `yarn lint`
- `yarn format:check`

The CI workflow is defined in `.github/workflows/ci.yml`.

## Protected Invariants

- Agent creation and restoration roll back unpublished Sessions, bindings, and scoped registrations on failure.
- Concurrent creation for one Agent id allows exactly one public owner; losers are disposed.
- Agent-scoped tools, prompt sections, context providers, and user projectors are removed when that Agent is disposed.
- Tool call intent is appended and checkpointed before a Tool `execute` callback runs.
- Tool results are persisted after execution with an explicit `ok`, `error`, or `interrupted` status.
- JSONL recovery synthesizes an interrupted result for a durable Tool Call without a result and never reruns the Tool.
- Session Event sequences and Surface topology restore deterministically from the persisted event log.
