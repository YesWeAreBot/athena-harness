# 03 - Agent Registry and Agent Loop

## What It Gives You

`AgentRegistry` is the stable multi-Agent entry point:

- one Agent Factory can be registered per registry;
- `create()` creates a new Agent;
- `resume()` restores an existing persisted or in-memory Session;
- lookup returns a non-owning Agent reference;
- only the owner handle can dispose an Agent;
- registry disposal removes the Agent from the public registry.

## Compose the Current Runtime

```ts
const ctx = new Context();

ctx.plugin(sessionStore);
ctx.plugin(agentRegistry);
ctx.plugin(modelSurface);
ctx.plugin(systemPrompt);
ctx.plugin(toolRuntime);
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

The default `agentLoop` now calls AI SDK `streamText()` directly:

- it validates that `user/message` or a registered custom projector is used;
- it appends the event to the Session with `surfaceOp: 'append'`;
- it derives model messages through `ctx.modelSurface`;
- it assembles the system prompt through `ctx.systemPrompt`;
- it snapshots schema-only tools through `ctx.tools`;
- it runs manual Steps and records `step/start`, `assistant/message`, `tool/call`, `tool/result`, and `step/end`;
- it executes tool calls and appends durable event records;
- it forwards native AI SDK stream parts through `agent/stream-part`;
- `cancel()` aborts the active AI SDK call, and `dispose()` waits for the loop to quiesce;
- it exposes idle/running status and `whenIdle()`.

## Developer Value

- Plugins can depend on `AgentRegistry` without depending on a concrete loop implementation.
- Agent ownership is explicit and disposal is idempotent.
- A real Agent Loop provider can later replace this implementation without changing Agent consumers.

## Current Boundary

The registry rejects duplicate live Agent ids before invoking the factory and drains registered Agents when the registry is disposed. The real loop is wired to `ctx.persist` for new Agents and flushes before model calls and tool side effects. When `ctx.persist` is installed, `resume()` restores a Session from JSONL and reopens a live binding.
