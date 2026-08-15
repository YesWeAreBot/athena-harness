# 01 - Session Event Log

## What It Gives You

A Session is one Agent's durable source of truth. It is an append-only event log:

- every event gets a contiguous `seq`;
- every event carries a `time`;
- event data is frozen at append time;
- the event list can be snapshotted without exposing internal mutation.

The event log is not a rendered chat transcript. It is the raw fact store from which model messages can later be derived.

## Built-in Event Types

The current built-in vocabulary is defined in `src/session/events.ts`:

- `turn/start`, `turn/end`
- `step/start`, `step/end`
- `user/message`
- `assistant/message`
- `tool/call`, `tool/result`
- `request/header`
- `context/snapshot`

Model-visible events currently require a `surfaceOp`; lifecycle and trace events forbid one.

## Usage

```ts
const ctx = new Context();
ctx.plugin(sessionStore);

const session = ctx.sessions.create({ id: "demo" });
session.append("turn/start", { turn: 1 });
session.append("user/message", { content: "hello" }, { surfaceOp: "append" });

console.log(session.snapshot().events);
```

Custom events are also allowed:

```ts
session.append(
  "external/event",
  { source: "web", payload: { id: 1 } },
  {
    ignorable: true,
  },
);
```

## Developer Value

- The event log is the single place where Agent history lives.
- Custom plugins can add their own structured events without changing the runtime.
- A future persistence layer can serialize the same log without a separate chat transcript format.
- Deterministic restoration becomes possible because the model input can be reconstructed from durable events.

## Current Boundary

Event data and event envelopes are deeply frozen, and `snapshotEvents` returns a frozen copy rather than the internal array. JSONL persistence is implemented; Tool Results carry an explicit `ok`, `error`, or `interrupted` status, and recovery never reruns a durable Tool Call.
