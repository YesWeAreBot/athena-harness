# 11 - Scheduler Infrastructure

## What It Gives You

`ctx.scheduler` provides generic scheduling primitives that Modes can compose:

- `timer`
- `tingle`
- `due-intent`
- `sweep`
- `auto-advance`
- `event` / `custom`

It does not implement any product scheduler.

## Usage

```ts
ctx.plugin(schedulerRegistry);

ctx.scheduler.schedule({
  lifeId: "athena-1",
  kind: "timer",
  after: 30_000,
  run: async ({ lifeId }) => {
    // mode-owned wake logic
  },
});
```

`ModeContext.scheduler` is a Life-scoped facade: it automatically fills `lifeId` and cancels the
Life's tasks when the active Mode is disposed.

## Lifecycle

- `schedule(options)` returns a handle with `cancel()`.
- `cancelByLife(lifeId)` and `cancelByOwner(owner)` support hot-unload cleanup.
- `stopAll()` is called when the SchedulerRegistry fiber is disposed.
