# 10 - Memory Infrastructure

## What It Gives You

`ctx.memory` is an early Life-scoped Memory infrastructure boundary. It is not a product memory
implementation and does not decide what should be remembered.

It provides:

- `remember(input)` to append a structured Life Memory record;
- `recall(lifeId, options)` to retrieve records by scope/category/query;
- `forget(id)` and `clear(lifeId)` for explicit removal.

## Status

This is early-stage infrastructure. Ingestion from Percepts, derived memory, compaction, forgetting
policy, and API stability are not finalized.

## Usage

```ts
ctx.plugin(memoryRegistry);

await ctx.memory.remember({
  lifeId: "athena-1",
  scope: "preference",
  category: "food",
  content: "likes tea",
});

const records = await ctx.memory.recall("athena-1", {
  scope: "preference",
  query: "tea",
});
```

The JSONL provider is also available:

```ts
ctx.plugin(jsonlMemory, { root: "./data/memory" });
```

## Boundary

Memory is passed to Modes through `ModeContext.memory`. A Mode may use it, but the core does not
impose a product-specific memory policy.
