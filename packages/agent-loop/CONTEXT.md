# @athena/agent-loop — Context

## Vocabulary

**AgentLoop** — the complete execution control strategy for one Turn. This package provides
the default native Tool Call Loop (`ReactLoopAgentFactory`). Not equal to one `streamText`
call. Do not call it runner or executor.

**Turn** — one bounded activation (see @athena/session). The loop drives one Turn per
`followup` call.

**Step** — one `streamText` call plus its tool execution results. One Turn = 1..maxSteps
Steps.

**descriptor-only** — tools passed to `streamText` have `execute` stripped (see ADR A2).
The loop calls `ctx.tools.descriptors()` for the model and `ctx.tools.executors()` for
actual execution.

**intent before side-effect** — `tool/call` is appended and flushed to persistence
_before_ `tool.execute()` is called. On crash, the Session contains the intent but no
result; `restore()` is lenient (spec C3) and the Runtime decides how to repair it.

**ConcreteAgent** — the internal class implementing the `Agent` interface. Manages the
status machine (`idle → running → stopping → disposed`) and drives the `Inbox`.
