# ADR I1 — ctx.sessions.setPersistence() instead of a separate Service

**Status:** Accepted

## Context

Persistence could be a Cordis Service (`ctx.persist`) registered alongside sessions, or
it could be a handler registered into the SessionRegistry via a method call.

## Decision

`SessionRegistry` has a single-slot `setPersistence(handler)` method. There is no separate
`SessionPersistence` Service class. The slot is set by the persistence plugin (e.g.
`persistJsonl`) calling `ctx.sessions.setPersistence(new JsonlHandler(config))`.

## Consequences

- Simpler: no extra Service, no extra `inject` declaration in agent-loop.
- Only one persistence backend can be active at a time (single-slot). Multiple backends
  would require a new design.
- Cordis effect wrapping ensures the slot is cleared when the plugin disposes.
