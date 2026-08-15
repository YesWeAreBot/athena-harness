# Athena Harness Feature Guides

This series is developer-facing. It explains the features that currently have implementation and tests, how to use them, and why they matter to someone building on Athena Harness.

It is intentionally different from [docs/design.md](../design.md): the design document records architecture decisions and acceptance criteria, while these guides describe the current developer experience.

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
| [07 - Tools and System Prompt](./07-tools-and-system-prompt.md)         | Scoped tool and prompt composition for the future Agent Loop.                           |

## Current Status

The repository is an early prototype. The following are implemented and tested:

- `Session`, `SessionStore`
- `SessionEventMap` and built-in event vocabulary
- `SurfaceManager` with append and replace semantics
- `ModelSurface` and custom user projectors
- `AgentRegistry`, owner-scoped handles, and a real `agentLoop` with text/tool Steps
- `BodyRegistry` and `PerceptEvent`
- `Persistence` and `JsonlPersistence`
- `ToolRuntime` and `SystemPrompt`

The real AI SDK `streamText()` loop now runs with model Surface, system prompt, tools, and event recording. Durable checkpoints, full restore wiring, Mode architecture, and actuator execution are not implemented yet.
