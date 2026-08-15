# 09 - Life and Mode

## What It Gives You

`LifeRegistry` and `ModeRegistry` are the first `athena-runtime` core contracts.

`Life` is a stable identity with a Session-backed memory handle:

```ts
const handle = ctx.lives.create({ id: "life-1" });
const life = handle.life;
```

`ModeRegistry` registers Mode definitions without implementing any specific Mode:

```ts
ctx.modes.register({
  name: "chat",
  setup: async () => ({}),
});
```

`ModeRegistry.create()` instantiates a registered definition into a `ModeHandle`. A Life can hold one active Mode and route percepts to it:

```ts
const life = ctx.lives.create({ id: "life-1" });
await life.setMode(await ctx.modes.create("chat", {}));
await life.dispatchPercept(event);
```

## Developer Value

- Life is now a distinct root concept from Agent.
- Mode definitions can be contributed by the community before the framework implements Chat, World, or Interlude.
- The core does not need to know how a future Mode drives itself.

## Current Boundary

Life can now hold a `ModeHandle` and route `PerceptEvent`s to it. It is not yet wired to AgentLoop, automatic BodyRegistry subscription, or Actuator execution. Mode-specific behavior remains a future consumer concern.

These contracts are experimental prototype records. The canonical baseline is `docs/architecture-foundation.md`, which leaves exact Life/Mode contracts pending.
