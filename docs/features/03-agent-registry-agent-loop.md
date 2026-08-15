# 03 - Agent Registry and Agent Loop

## What It Gives You

`AgentRegistry` is the stable multi-Agent entry point:

- one Agent Factory can be registered per registry;
- `create()` creates a new Agent;
- `resume()` restores an existing in-memory Session;
- lookup returns a non-owning Agent reference;
- only the owner handle can dispose an Agent;
- registry disposal removes the Agent from the public registry.

## Compose the Current Runtime

```ts
const ctx = new Context();

ctx.plugin(sessionStore);
ctx.plugin(agentRegistry);
ctx.plugin(modelSurface);
ctx.plugin(agentLoop);
```

## Create and Dispose an Agent

```ts
const handle = await ctx.agents.create({
  model: mockModel,
  maxSteps: 8,
});

handle.agent.send("user/message", { content: "hello" });
await handle.agent.whenIdle();

await ctx.agents.dispose(handle.agent.id);
```

`AgentRegistry` wraps the handle returned by the factory. The public handle is the owner capability; `ctx.agents.get(id)` only returns the Agent reference.

## Current Agent Loop

The default `agentLoop` is intentionally a lifecycle placeholder:

- it validates that `user/message` or a registered custom projector is used;
- it appends the event to the Session with `surfaceOp: 'append'`;
- it exposes idle/running status and `whenIdle()`;
- it does not yet call AI SDK `streamText()`.

This boundary keeps the registry and factory contract stable while the real loop is implemented next.

## Developer Value

- Plugins can depend on `AgentRegistry` without depending on a concrete loop implementation.
- Agent ownership is explicit and disposal is idempotent.
- A real Agent Loop provider can later replace the placeholder without changing Agent consumers.

## Current Boundary

There is no durable persistence or crash recovery yet. The registry now rejects duplicate live Agent ids before invoking the factory and drains registered Agents when the registry is disposed. A stronger factory-level transaction should be revisited when the real loop introduces external side effects.
