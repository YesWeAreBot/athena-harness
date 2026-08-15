# ADR G1 — Write-time invariants enforced inside Session.append()

**Status:** Accepted

## Context

Session events have ordering constraints (e.g. a `tool/result` must follow a `tool/call`;
events cannot be appended to a closed turn). These constraints could be checked optionally
via a plugin, or enforced unconditionally.

## Decision

All four invariants are checked unconditionally inside `Session.append()`. Violation throws
a typed error immediately. There is no option to disable them.

## Consequences

- Invalid sessions cannot be constructed accidentally.
- Tests that want to simulate "broken" state (e.g. for crash recovery) must use
  `restoreSession()` which bypasses invariants intentionally (spec C3).
- The invariant check is part of the public `Session` contract, not an implementation detail.
