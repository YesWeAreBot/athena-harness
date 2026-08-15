# Athena Harness Core — Context Map

> This file is the index. Each package has its own CONTEXT.md covering the vocabulary
> terms relevant to that package. ADRs explain non-obvious design decisions.

## Packages

| Package | CONTEXT.md | Responsibility |
|---|---|---|
| [@athena/session](packages/session/CONTEXT.md) | Session, Surface, SurfaceOp, SessionBinding | append-only execution log, Surface projection, persistence interface |
| [@athena/tools](packages/tools/CONTEXT.md) | ToolGate, AgentKey | tool registration, scoped views, ToolGate filtering |
| [@athena/prompt](packages/prompt/CONTEXT.md) | PromptSection | system prompt composition, rendered fingerprint |
| [@athena/agent](packages/agent/CONTEXT.md) | Agent, Inbox, followup/steer/inject, claim | Agent interface, two-slot Inbox, AgentRegistry |
| [@athena/agent-loop](packages/agent-loop/CONTEXT.md) | Turn, Step, AgentLoop | default native Tool Call Loop implementation |
| [@athena/persist-jsonl](packages/persist-jsonl/CONTEXT.md) | SessionBinding | JSONL persistence handler |

## ADRs

| Decision | File |
|---|---|
| A2 — descriptor-only tool pattern | [docs/adr/adr-A2-descriptor-only-tools.md](docs/adr/adr-A2-descriptor-only-tools.md) |
| G1 — write-time invariants enforced in append() | [docs/adr/adr-G1-append-invariants.md](docs/adr/adr-G1-append-invariants.md) |
| H2 — surfaceOp.replace in event format from day one | [docs/adr/adr-H2-surface-op-replace.md](docs/adr/adr-H2-surface-op-replace.md) |
| I1 — setPersistence() single-slot instead of Service | [docs/adr/adr-I1-persistence-single-slot.md](docs/adr/adr-I1-persistence-single-slot.md) |
| J1 — followup / steer / inject three-method Inbox | [docs/adr/adr-J1-inbox-three-methods.md](docs/adr/adr-J1-inbox-three-methods.md) |

## Primary design reference

`docs/spark/2026-08-15-harness-core-design.md` — approved spec, read before anything else.
