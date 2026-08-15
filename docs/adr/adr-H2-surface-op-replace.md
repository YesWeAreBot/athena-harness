# ADR H2 — surfaceOp.replace baked into event format from day one

**Status:** Accepted

## Context

The Surface is the model-visible view of the Session log. A future compaction strategy will
need to replace a range of Surface nodes with a single synthetic node to keep the context
window from growing unbounded. We could add this later, or put the plumbing in from the start.

## Decision

`SessionEvent` has an optional `surfaceOp` field that can be `'append'` or
`{ replace: { start, end } }` from day one. The first version does not implement any
automatic compaction strategy — that remains a Runtime concern. Only the field and the
application logic (splice the nodes array) are present.

## Consequences

- Any future compaction can be added without a breaking change to the event schema.
- Snapshots/restore already round-trip `replace` ops correctly.
- No compaction policy is shipped with Harness Core.
