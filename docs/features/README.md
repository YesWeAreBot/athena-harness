# Athena Harness Feature Guides

This series is developer-facing. It explains the features that currently have implementation and tests, how to use them, and why they matter to someone building on Athena Harness.

It is intentionally different from [docs/design.md](../design.md) and [athena-runtime-design.md](../athena-runtime-design.md): the design documents record architecture decisions and acceptance criteria, while these guides describe the current developer experience.

See [Positioning](../positioning.md) for the project's target layer and ecosystem boundaries.

## Guides

| Guide                                                                   | What it covers                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [01 - Session Event Log](./01-session-event-log.md)                     | Append-only session events, built-in event types, and custom events.                    |
| [02 - Surface and Model Surface](./02-surface-model-surface.md)         | Surface topology, event replacement, and deterministic AI SDK message derivation.       |
| [03 - Agent Registry and Agent Loop](./03-agent-registry-agent-loop.md) | Cordis composition, agent creation, ownership, disposal, and the current loop boundary. |
| [04 - Development Workflow](./04-development-workflow.md)               | Local commands, module layout, verification, and contribution loop.                     |
| [05 - Body and Percept](./05-body-and-percept.md)                       | Body registration and non-IM percept events.                                            |
| [06 - Persistence](./06-persistence.md)                                 | JSONL lifetime memory, restore, and crash-orphaned Turn repair.                         |
| [07 - Tools and System Prompt](./07-tools-and-system-prompt.md)         | Scoped tool and prompt composition for the real Agent Loop.                             |
| [08 - Agent Events](./08-agent-events.md)                               | Agent status/output/stream-part observation and abort behavior.                         |
| [09 - Life and Mode](./09-life-and-mode.md)                             | Life identity, Mode definition registry, and Percept routing.                           |
| [10 - Memory Infrastructure](./10-memory-infrastructure.md)             | Early Life-scoped memory contract, in-memory and JSONL providers.                       |
| [11 - Scheduler Infrastructure](./11-scheduler-infrastructure.md)       | Generic timer/tingle/due-intent/sweep/auto-advance primitives.                          |
| [12 - AgentLoop Provider](./12-agent-loop-provider.md)                  | Mode-selectable AgentLoop provider slot.                                                |
| [13 - Body Adapter](./13-body-adapter.md)                              | Bridge existing Koishi platform adapters into Life Bodies.                              |

## Current Status

The repository is an early prototype. The following are implemented and tested:

- `Session`, `SessionStore`
- `SessionEventMap` and built-in event vocabulary
- `SurfaceManager` with append and replace semantics
- `ModelSurface` and custom user projectors
- `AgentRegistry`, owner-scoped handles, `AgentContext` setup, and a real `agentLoop` with text/tool Steps
- durable `context/snapshot` events, `request/header` records, and `max-tokens` / `max-steps` end reasons
- Tool Call intent/results with explicit `ok`, `error`, and `interrupted` status
- `BodyRegistry`, `PerceptEvent`, and Actuator execution through `ctx.bodies.act()`
- `LifeRegistry` / `ModeRegistry` lifecycle with hot-unload-safe disposal
- Early `LifeMemory` contract with in-memory and JSONL providers
- `SchedulerRegistry` primitives and `AgentLoopRegistry` provider slot
- `Persistence` and `JsonlPersistence`
- `ToolRuntime` and `SystemPrompt`
- Agent Events with `agentEvents(ctx, agent)`
- `LifeRegistry` and `ModeRegistry`

The real AI SDK `streamText()` loop now runs with model Surface, system prompt, tools, event recording, durable checkpoints, and JSONL resume. Mode implementations, Life-to-AgentLoop wiring, and Athena Runtime Memory remain future work.
