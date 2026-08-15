# Athena Harness Feature Guides

> **Note**: The original 13 feature guides described the prototype implementation and have been archived to `docs/archive/prototype-guides/features/`. New guides for the canonical 6-package architecture will be created here.

## Canonical Implementation (@athena/* packages)

The 6-package Harness Core architecture is fully implemented per `docs/spark/2026-08-15-harness-core-design.md`.

### Quick Reference

| Package | Purpose | Key Types |
|---------|---------|-----------|
| **@athena/session** | Append-only event log, Surface projection | `Session`, `SessionRegistry`, `Surface`, `SessionEvent` |
| **@athena/tools** | Tool registration with scoped visibility | `ToolRegistry`, descriptor-only vs executors, tool gate |
| **@athena/prompt** | System prompt composition | `SystemPrompt`, `PromptSection`, fingerprint caching |
| **@athena/agent** | Agent interface and inbox | `Agent`, `AgentRegistry`, `AgentFactory`, `Inbox` (followup/steer/inject) |
| **@athena/agent-loop** | React loop implementation | `ConcreteAgent`, turn runner, `ReactLoopAgentFactory` |
| **@athena/persist-jsonl** | JSONL persistence | `JsonlHandler`, `JsonlSessionBinding` |

### Usage Examples

**Create a session and agent:**

```typescript
import { Context } from 'cordis'
import { sessionRegistry } from '@athena/session'
import { toolRegistry } from '@athena/tools'
import { systemPrompt } from '@athena/prompt'
import { agentRegistry } from '@athena/agent'
import { agentLoop } from '@athena/agent-loop'
import { persistJsonl } from '@athena/persist-jsonl'

const ctx = new Context()
ctx.plugin(sessionRegistry)
ctx.plugin(toolRegistry)
ctx.plugin(systemPrompt)
ctx.plugin(agentRegistry)
ctx.plugin(agentLoop)
ctx.plugin(persistJsonl, { dir: './sessions' })

// Create agent
const handle = await ctx.agents.create({
  model: myLanguageModel,
  maxSteps: 10,
  setup(agentCtx) {
    // Register scoped tools and prompt sections
  }
})

// Send input
handle.agent.followup({ role: 'user', content: 'Hello!' })

// Wait for idle
await handle.agent.whenIdle()

// Cleanup
await handle.dispose()
```

**Register tools:**

```typescript
// Global tool
ctx.tools.register('get_weather', {
  description: 'Get current weather',
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => getWeather(city)
})

// Agent-scoped tool
const agentKey = Symbol('my-agent')
ctx.tools.register('private_tool', myTool, agentKey)

// Get descriptors for streamText (no execute)
const descriptors = ctx.tools.descriptors(agentKey)

// Get executors for running tools
const executors = ctx.tools.executors(agentKey)
```

**Add prompt sections:**

```typescript
ctx.systemPrompt.add({
  name: 'identity',
  order: 0,
  render: () => 'You are a helpful assistant.'
})

// Agent-scoped section
ctx.systemPrompt.add({
  name: 'agent-context',
  order: 10,
  render: async () => await getAgentContext()
}, agentKey)

// Assemble
const { system, rendered } = await ctx.systemPrompt.assemble(agentKey)
```

**Inbox patterns:**

```typescript
// followup: next-turn slot, wakes loop, new Turn
agent.followup({ role: 'user', content: 'Hello' })

// steer: next-step slot, wakes loop, same Turn
agent.steer({ role: 'user', content: 'Correction: use Celsius' })

// inject: next-step slot, no wake, passive accumulation
agent.inject({ role: 'user', content: 'Background info' })
```

### Architecture

**Strict downward dependencies:**

```
persist-jsonl  →  session
agent-loop     →  agent, session, tools, prompt
agent          →  session
prompt         →  cordis
tools          →  cordis, ai (types only)
session        →  cordis, ai (types only)
```

No circular dependencies. No imports from `athena-runtime`, `koishi`, or product layers.

### Testing

All packages have comprehensive test coverage:
- Invariants and contract tests
- Scoped visibility and tool gate tests
- Inbox slot semantics
- AgentFactory seam verification
- Turn lifecycle, tool call order, maxSteps
- Teardown and disposal cleanup

Run tests: `yarn test`

### Documentation

- **Canonical spec**: [spark/2026-08-15-harness-core-design.md](../spark/2026-08-15-harness-core-design.md)
- **Architecture baseline**: [architecture-foundation.md](../architecture-foundation.md)
- **Glossary**: [glossary.md](../glossary.md)
- **ADRs**: [adr/](../adr/)
- **Implementation status**: [STATUS.md](../STATUS.md)

### Archived Prototype Guides

The original 13 feature guides describing `@yesimbot/harness-core` are archived at:
- **[../archive/prototype-guides/features/](../archive/prototype-guides/features/)**

These show the evolution from prototype to canonical implementation.
