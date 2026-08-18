# @athena/tools — Context

## Vocabulary

**ToolRegistry** (`ctx.tools`) — registers tools globally or per-AgentKey; produces
descriptor-only or full-executor ToolSets on demand.

**AgentKey** — a `symbol` that identifies one Agent. Used as the scope key for per-agent
tool registrations. Not a named type — use `symbol` directly.

**ToolGate** — the `activeTools?: ReadonlySet<string>` filter passed to `descriptors()` /
`executors()`. Limits which tools the model sees at runtime. The mechanism behind World
Mode's `open_app` door control. Do not call it tool filter or whitelist.

**Descriptor-only** — a tool object with `execute` stripped. When passed to `streamText`,
the AI SDK stops the loop when it generates a call to one of these tools (because there
is no executor to run). The loop then executes the tool itself. See ADR A2.
