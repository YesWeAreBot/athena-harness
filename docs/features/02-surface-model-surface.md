# 02 - Surface and Model Surface

## What It Gives You

The Session Event Log is open to any event type. The Surface is the closed projection topology used to decide what the model sees.

The current Surface supports:

- `append`: add one event to the model-visible sequence;
- `replace`: shadow an inclusive range of existing Surface nodes with one new event.

`ModelSurface` derives AI SDK `ModelMessage[]` from the Surface and the durable event log.

## Append a Model-Visible Event

```ts
session.append(
  "user/message",
  { content: "hello" },
  {
    surfaceOp: "append",
  },
);
```

Lifecycle events cannot carry a Surface op:

```ts
// This throws:
session.append("turn/start", { turn: 1 }, { surfaceOp: "append" });
```

## Replace a Range

```ts
const first = session.append("user/message", { content: "first" }, { surfaceOp: "append" });
const second = session.append("user/message", { content: "second" }, { surfaceOp: "append" });
const replacementSeq = session.length + 1;

session.append(
  "user/message",
  { content: "replacement" },
  {
    surfaceOp: { op: "replace", start: 0, end: 1 },
    sourceEventSeqs: [first.seq, second.seq, replacementSeq],
  },
);
```

Replacement requires the complete source event set so later restore validation can prove which facts were shadowed.

## Derive Model Messages

```ts
const messages = ctx.modelSurface.deriveMessages(session);
```

The result is a fresh AI SDK `ModelMessage[]`:

- `user/message` becomes a user message;
- `assistant/message` becomes an assistant message;
- `tool/result` becomes a tool message;
- `context/snapshot` becomes a user message containing the rendered dynamic context;
- custom Surface events require a registered user projector.

## Custom User Projector

```ts
ctx.modelSurface.registerUserProjector("external/message", (event) => {
  const data = event.data as { text: string };
  return `external:${data.text}`;
});
```

Agent-scoped plugins can register the same projector through `AgentContext`:

```ts
setup: (agent) => {
  agent.modelSurface.registerUserProjector("external/message", (event) => {
    const data = event.data as { text: string };
    return `external:${data.text}`;
  });
},
```

The custom event remains unchanged in the log; only the derived model message is generated from it.

## Developer Value

- Model input is deterministic and replayable from durable events.
- Plugins can add model-visible input without persisting a duplicate `user/message`.
- The runtime can validate restoration by comparing the Surface and event log.

## Current Boundary

Only user-message projection is extensible. Assistant and tool messages are core-owned. User projectors may be registered root-globally or per Agent scope, and scoped projectors are removed when the Agent is disposed. Projectors must be pure; the runtime does not yet enforce purity at runtime.
