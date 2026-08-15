# ADR J1 — followup / steer / inject — three methods, two slots

**Status:** Accepted

## Context

An Agent needs to receive input at different points in its execution cycle:
- New user messages that should start a fresh Turn
- Mid-turn steering input that should be visible at the next Step
- Passive environment observations that accumulate without urgency

## Decision

Three methods map to two slots:

| Method | Slot | Wakes loop? | When claimed |
|---|---|---|---|
| `followup(content)` | next-turn | yes | top of next Turn |
| `steer(content)` | next-step | yes | top of next Step |
| `inject(content)` | next-step | no | top of next Step |

`followup` and `steer` both wake the loop (transition idle→running). `inject` does not —
it is for background environment updates that should not interrupt the Agent's idle state.

## Consequences

- Callers can choose the appropriate urgency level.
- `steer` and `inject` both go to the same slot; the only difference is whether the loop
  wakes immediately. If the loop is already running, both behave identically.
- World Mode's environment observation system uses `inject` to accumulate percepts without
  spinning up a Turn for each one.
