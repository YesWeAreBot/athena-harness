# 12 - AgentLoop Provider Infrastructure

## What It Gives You

`ctx.agentLoop` is a provider slot so Modes can choose their own AgentLoop without athena-runtime
implementing Chat, World, or Interlude loops.

```ts
ctx.plugin(agentLoopRegistry);

const dispose = ctx.agentLoop.register({
  id: "my-loop",
  factory: {
    create: async (input) => {
      /* return AgentHandle */
    },
    resume: async (input) => {
      /* return AgentHandle */
    },
  },
});
```

`ModeContext.agentLoop` exposes the same access to a Mode.

## Boundary

- `AgentLoopRegistry` only registers providers and delegates `create` / `resume`.
- It does not run a loop itself.
- A future Chat/World/Interlude Mode may register its own provider without changing athena-runtime.
