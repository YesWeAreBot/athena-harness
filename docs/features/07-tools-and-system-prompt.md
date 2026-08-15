# 07 - Tools and System Prompt

## What It Gives You

`ctx.tools` and `ctx.systemPrompt` are the scoped composition services consumed by the real Agent Loop.

They let plugins register capabilities in two layers:

- a global/root layer;
- an agent/life scope layer.

Scoped entries shadow global entries with the same name. Disposing a registration removes only that registration's effect.

## Register Tools

```ts
ctx.plugin(toolRuntime);

const dispose = ctx.tools.register("echo", tool);
const snapshot = ctx.tools.snapshot();
```

Inside `AgentContext.setup`, the same registration is installed against the Agent's scope:

```ts
setup: (agent) => {
  agent.tools.register("echo", scopedTool);
  agent.systemPrompt.registerSection("identity", "scoped identity");
},
```

`ctx.tools.snapshot(scope)` returns the merged model-facing tool set with scoped entries shadowing globals.

## Assemble a System Prompt

```ts
ctx.plugin(systemPrompt);

ctx.systemPrompt.registerSection("identity", "you are a digital life");
ctx.systemPrompt.registerContextProvider("time", async () => new Date().toISOString());

const snapshot = await ctx.systemPrompt.snapshot();
```

`snapshot.system` contains ordered static sections. `snapshot.context` contains rendered dynamic context values, and `snapshot.rendered` is the joined context text.

## Developer Value

- Tools and prompt contributions are reversible Cordis effects.
- Agent-scoped plugins can override global capabilities without leaking into other Agents.
- The Agent Loop can take immutable snapshots per Step without depending on live registrations.

## Current Boundary

This slice provides registration, shadowing, and snapshot assembly, and is wired into the real `agentLoop`. `AgentContext` creates and owns the Agent scope symbol, so setup callers do not need to manage symbols manually. Durable checkpoints are now flushed before tool side effects.
