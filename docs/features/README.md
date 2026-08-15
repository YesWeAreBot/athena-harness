# Athena Harness Feature Guides

This series is developer-facing. It explains the features that currently have implementation and tests, how to use them, and why they matter to someone building on Athena Harness.

It is intentionally different from [docs/design.md](../design.md): the design document records architecture decisions and acceptance criteria, while these guides describe the current developer experience.

## Guides

| Guide                                                                   | What it covers                                                                          |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [01 - Session Event Log](./01-session-event-log.md)                     | Append-only session events, built-in event types, and custom events.                    |
| [02 - Surface and Model Surface](./02-surface-model-surface.md)         | Surface topology, event replacement, and deterministic AI SDK message derivation.       |
| [03 - Agent Registry and Agent Loop](./03-agent-registry-agent-loop.md) | Cordis composition, agent creation, ownership, disposal, and the current loop boundary. |
| [04 - Development Workflow](./04-development-workflow.md)               | Local commands, module layout, verification, and contribution loop.                     |

## Current Status

The repository is an early prototype. The following are implemented and tested:

- `Session`, `SessionStore`
- `SessionEventMap` and built-in event vocabulary
- `SurfaceManager` with append and replace semantics
- `ModelSurface` and custom user projectors
- `AgentRegistry`, owner-scoped handles, and a placeholder `agentLoop` factory

The real AI SDK `streamText()` loop, durable persistence, tools, prompt composition, and Mode architecture are not implemented yet.
