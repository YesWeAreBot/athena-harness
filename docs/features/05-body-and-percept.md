# 05 - Body and Percept

## What It Gives You

`BodyRegistry` and `PerceptEvent` are the first vision-aligned seams for non-chat existence.

A Body is an entity's interface to an environment:

```text
Body = Senses + Actuators + Body State
```

Examples:

- an IM Body;
- a Bilibili or Xiaohongshu Body;
- a Minecraft Body;
- a computer/filesystem Body;
- a voice/camera Body;
- a physical robot shell.

The core does not know what a Body is. It only knows that a Body can exist, and that a Body can produce `PerceptEvent`s.

## Register a Body

```ts
ctx.plugin(bodyRegistry);

const disposeBody = ctx.bodies.register({
  id: "minecraft",
  state: { dimension: "overworld" },
  senses: [{ id: "vision", kind: "world" }],
  actuators: [{ id: "move", kind: "world" }],
});
```

## Dispatch a Percept

```ts
ctx.on("body/percept", (event) => {
  console.log(event.bodyId, event.kind, event.data);
});

ctx.bodies.dispatch("minecraft", "world/observation", {
  block: "dirt",
});
```

The event is frozen and includes a stable id, timestamp, body id, kind, and structured data.

## Developer Value

- IM is no longer a special layer. It is one Body kind.
- Plugin authors can create community senses such as Bilibili, Xiaohongshu, Minecraft, cameras, or physical shells.
- The core can later route percepts to life memory and mode-specific attention without knowing the source.

## Current Boundary

This first slice registers Bodies and dispatches percepts. It does not yet implement:

- autonomous life tick or scheduler;
- Mode selection and routing;
- memory ingestion from percepts;
- actuator execution through `BodyRegistry`.
