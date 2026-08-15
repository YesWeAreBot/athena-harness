# @athena/session — Context

## Vocabulary

**Session** — append-only log of Agent execution facts. The single source of truth for model
input projection and crash recovery. Do not call it conversation, history, or thread.

**Surface** — the model-visible view of the Session event log, maintained by applying
`SurfaceOp` instructions as events are appended. It is a pure derivative of the log — it
holds no independent state. Do not call it context window or message history.

**SurfaceOp** — the projection instruction attached to a SessionEvent: `'append'` (default,
add node to end) or `{ replace: { start, end } }` (collapse a range of nodes into one).
Do not call it compaction or pruning.

**Turn** — a bounded Agent activation delimited by `turn/start` and `turn/end`. Not the same
as one user message.

**Step** — a single model request and its direct results, delimited by `step/start` /
`step/end`. One Turn contains one or more Steps.

**SessionBinding** — a write handle to an open persistence file: `append` (sync, buffered),
`flush` (drain to disk), `close`. Do not call it writer or handle.

**SessionPersistenceHandler** — the interface implemented by a persistence backend (e.g.
`@athena/persist-jsonl`). Registered via `ctx.sessions.setPersistence()` — single slot,
not a separate Service (see ADR I1).

**TurnEndReason** — discriminated union describing why a Turn ended: `completed`, `aborted`,
`error`, `max-tokens`, `max-steps`, `interrupted`.

**ToolResultStatus** — `'ok' | 'error' | 'interrupted'`.

## Write-time invariants (enforced inside Session.append)

1. `step/*` / `tool/*` events referencing a turn that has no open `turn/start` → `TurnNotOpenError`
2. `tool/result` with no matching `tool/call` in the same turn+step → `ToolCallMissingError`
3. Any event for a turn that already has `turn/end` → `TurnClosedError`
4. `surfaceOp.replace` range out of bounds → `InvalidReplaceRangeError`

These are non-optional. See ADR G1.
