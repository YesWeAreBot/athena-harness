# 08 - Agent Events

## What It Gives You

`agentEvents(ctx, agent)` is a subject-bound observer for one live Agent.

Current events:

- `agent/status` for idle, running, stopping, and disposed transitions;
- `agent/output` for displayable output, currently the final AI SDK Assistant Message;
- `agent/stream-part` for native AI SDK stream parts;
- `agent/error` for failed Turns with optional Turn/Step context.

## Usage

```ts
const subject = agentEvents(ctx, agent);

subject.on("agent/status", (event) => {
  console.log(event.status);
});

subject.on("agent/stream-part", (event) => {
  console.log(event.part);
});
```

## Abort

`agent.cancel(cause)` now aborts the active AI SDK call through an `AbortSignal`. The loop closes the current Turn with:

```ts
{
  kind: ("aborted", cause);
}
```

`dispose()` also aborts an active call and waits for the loop to reach quiescence before closing persistence and removing the Session.

## Developer Value

- External observers no longer need to read the Session Event log to know whether an Agent is alive.
- UI, console, logging, and future WebUI can subscribe to a specific Agent without filtering global events manually.
- Stream parts provide a bridge to token-level visualization without persisting them.

## Current Boundary

`agent/output` currently emits the final Assistant Message, not incremental text deltas. `agent/stream-part` forwards native AI SDK parts internally, but token-level parts are not persisted.
