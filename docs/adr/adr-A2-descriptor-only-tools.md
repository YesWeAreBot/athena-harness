# ADR A2 — Descriptor-only tools passed to streamText

**Status:** Accepted

## Context

The Agent Loop calls `streamText` from the AI SDK to run the model. Tools can be passed
as a `ToolSet`. If a tool has an `execute` function, the SDK will call it internally and
continue the loop automatically. That makes it hard to observe, test, or log each step
individually.

## Decision

Tools are passed to `streamText` **without `execute`** (descriptor-only). When the model
generates a tool call, the SDK finishes the stream immediately (because there is no executor
to run), and the loop regains control. The loop then reads `finalStep.toolCalls`, appends
`tool/call`, flushes to persistence, calls `ctx.tools.executors()` to run the tool,
appends `tool/result`, and continues.

`ToolRegistry.descriptors()` strips `execute` from every tool before returning the ToolSet.
`ToolRegistry.executors()` preserves `execute` for the loop's own use.

## Consequences

- Every tool call and result is observable as a SessionEvent.
- `tool/call` intent is on disk before `execute()` runs (crash-safe).
- Each `streamText` call covers exactly one Step.
- The AI SDK's built-in multi-step loop is not used.
