# 06 - Persistence

## What It Gives You

`ctx.persist` is the first lifetime-memory foundation. It lets a Session survive process restart by materializing its Event log to JSONL.

The design document confirms:

- abstract `Persistence` service;
- `JsonlPersistence` provider;
- create, append, flush, close, and prepare operations;
- JSONL v0 format;
- crash-orphaned Turn repair.

## Use the JSONL Provider

```ts
ctx.plugin(jsonlPersistence, {
  root: "./data/lives",
});
```

Then create a binding:

```ts
const session = new Session({ id: "life-1" });
session.append("user/message", { content: "hello" }, { surfaceOp: "append" });

const binding = await ctx.persist.create(session.header);
binding.append(session.snapshotEvents);
await binding.flush();
await binding.close();
```

Restore later:

```ts
const prepared = await ctx.persist.prepare("life-1");
console.log(prepared.events);
await prepared.close();
```

## Crash Recovery

If a valid JSONL file ends inside an open Turn, `prepare()`:

- synthesizes error Tool Results for durable Tool Calls without results;
- appends missing Step/Turn closers;
- appends `turn/end` with `{ kind: "interrupted" }`;
- flushes the repair events before returning the prepared Session.

It never reruns a Tool, and malformed or truncated records are rejected.

## Developer Value

- A life's Event log can survive restart.
- The same durable log is the future source of identity and biography.
- Restoration is deterministic because memory and Surface can be rebuilt from the same facts.

## Current Boundary

Persistence is wired into the default `agentLoop`. Newly created Agents get a live binding; the Agent Loop flushes before model calls and tool side effects, and closes the binding on disposal. Context snapshots and request headers are persisted with the same event log. When `ctx.persist` is installed, `resume()` restores a Session from JSONL, runs the new Agent setup, and reopens a live binding; setup failure rolls back the restored Session and closes the binding without deleting the durable file.
