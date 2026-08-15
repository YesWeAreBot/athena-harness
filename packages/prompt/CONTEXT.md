# @athena/prompt — Context

## Vocabulary

**PromptSection** — one named, ordered contributor to the system prompt. Has `name`,
optional `order` weight (ascending, default 0), and `render(signal?)` returning a string.

**SystemPrompt** (`ctx.systemPrompt`) — assembles all registered sections into a single
system string. Supports global sections and per-AgentKey scoped sections (scoped overrides
global when names collide).

**rendered fingerprint** — a SHA-256 hex digest of the assembled system string. agent-loop
compares this between Steps; if unchanged, the `context/snapshot` event is not re-appended.
Equal fingerprints guarantee equal system content.
