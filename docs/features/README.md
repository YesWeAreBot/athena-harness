# Athena Harness Core — Usage Guide

> **For**: The canonical 6-package architecture (`@athena/*` packages)  
> **Status**: ✅ Fully implemented and tested  
> **Spec**: [spark/2026-08-15-harness-core-design.md](../spark/2026-08-15-harness-core-design.md)

This guide shows how to use the 6 `@athena/*` packages that form Athena Harness Core.

For the original prototype feature guides, see [archive/prototype-guides/](../archive/prototype-guides/).

## Package Overview

| Package                   | Purpose                                   | Key Types                                                                 |
| ------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| **@athena/session**       | Append-only event log, Surface projection | `Session`, `SessionRegistry`, `Surface`, `SessionEvent`                   |
| **@athena/tools**         | Tool registration with scoped visibility  | `ToolRegistry`, descriptor-only vs executors, tool gate                   |
| **@athena/prompt**        | System prompt composition                 | `SystemPrompt`, `PromptSection`, fingerprint caching                      |
| **@athena/agent**         | Agent interface and inbox                 | `Agent`, `AgentRegistry`, `AgentFactory`, `Inbox` (followup/steer/inject) |
| **@athena/agent-loop**    | React loop implementation                 | `ConcreteAgent`, turn runner, `ReactLoopAgentFactory`                     |
| **@athena/persist-jsonl** | JSONL persistence                         | `JsonlHandler`, `JsonlSessionBinding`                                     |

## Quick Start

### Basic Setup

```typescript
import { Context } from "cordis";
import { sessionRegistry } from "@athena/session";
import { toolRegistry } from "@athena/tools";
import { systemPrompt } from "@athena/prompt";
import { agentRegistry } from "@athena/agent";
import { agentLoop } from "@athena/agent-loop";
import { persistJsonl } from "@athena/persist-jsonl";

const ctx = new Context();
ctx.plugin(sessionRegistry);
ctx.plugin(toolRegistry);
ctx.plugin(systemPrompt);
ctx.plugin(agentRegistry);
ctx.plugin(agentLoop);
ctx.plugin(persistJsonl, { dir: "./sessions" });

// Create agent
const handle = await ctx.agents.create({
  model: myLanguageModel,
  maxSteps: 10,
  setup(agentCtx) {
    // Register scoped tools and prompt sections here
  },
});

// Send input
handle.agent.followup({ role: "user", content: "Hello!" });

// Wait for completion
await handle.agent.whenIdle();

// Cleanup
await handle.dispose();
```

## Usage Patterns

### Tool Registration

```typescript
// Global tool (visible to all agents)
ctx.tools.register("get_weather", {
  description: "Get current weather",
  parameters: z.object({ city: z.string() }),
  execute: async ({ city }) => getWeather(city),
});

// Agent-scoped tool (only visible to this agent)
const agentKey = Symbol("my-agent");
ctx.tools.register("private_tool", myTool, agentKey);

// Get descriptors for streamText (no execute function)
const descriptors = ctx.tools.descriptors(agentKey);

// Get executors for running tools (with execute function)
const executors = ctx.tools.executors(agentKey);

// Tool gate (filter visible tools)
const activeTools = new Set(["get_weather", "search"]);
const gatedDescriptors = ctx.tools.descriptors(agentKey, activeTools);
```

### Prompt Sections

```typescript
// Global section
ctx.systemPrompt.add({
  name: "identity",
  order: 0,
  render: () => "You are a helpful assistant.",
});

// Agent-scoped section
ctx.systemPrompt.add(
  {
    name: "agent-context",
    order: 10,
    render: async () => await getAgentContext(),
  },
  agentKey,
);

// Assemble prompt
const { system, rendered } = await ctx.systemPrompt.assemble(agentKey);
// `rendered` is a fingerprint for deduplication
```

### Inbox Input Methods

```typescript
// followup: next-turn slot, wakes loop, starts new Turn
agent.followup({ role: "user", content: "Hello" });

// steer: next-step slot, wakes loop, continues current Turn
agent.steer({ role: "user", content: "Correction: use Celsius" });

// inject: next-step slot, no wake, passive accumulation
agent.inject({ role: "user", content: "Background info" });
```

### Session Access

```typescript
// Access agent's session
const session = handle.agent.session;

// Append custom events
session.append("custom/event", { data: "value" });

// Get snapshot
const snapshot = session.snapshot();

// Access Surface (model-visible view)
const surface = session.surface;
const messages = surface.deriveMessages(projectorMap);
```

### Persistence

```typescript
// Sessions are automatically persisted when persistJsonl is loaded
// Each session → {dir}/{id}.jsonl

// Restore from JSONL
const prepared = await ctx.sessions.persistence.prepare(sessionId);
const session = ctx.sessions.restore(prepared.header, prepared.events);
await prepared.close();

// Resume agent from persisted session
const handle = await ctx.agents.resume({
  id: sessionId,
  model: myLanguageModel,
  maxSteps: 10,
});
```

## Architecture

### Strict Dependency Graph (Downward Only)

```
persist-jsonl  →  session
agent-loop     →  agent, session, tools, prompt
agent          →  session
prompt         →  cordis
tools          →  cordis, ai (types only)
session        →  cordis, ai (types only)
```

No circular dependencies. No imports from `athena-runtime`, `koishi`, or product layers.

### Key Concepts

- **Session**: Append-only event log, single source of truth for agent execution
- **Surface**: Model-visible projection of session events (subset derived via surfaceOp)
- **Turn**: One complete agent activation (turn/start → turn/end)
- **Step**: One model request within a Turn (step/start → step/end)
- **AgentLoop**: Replaceable execution strategy via AgentFactory seam
- **AgentKey**: Symbol identifying an agent for scoped tools/prompt
- **Inbox**: Two-slot buffer (next-turn, next-step) for input accumulation

See [glossary.md](../glossary.md) for full terminology.

## Testing

All packages have comprehensive test coverage (30 test files):

```bash
# Run all tests
yarn test

# Test specific package
yarn workspace @athena/session test
yarn workspace @athena/tools test
yarn workspace @athena/agent-loop test
```

## Documentation

- **Implementation status**: [STATUS.md](../STATUS.md)
- **Canonical spec**: [spark/2026-08-15-harness-core-design.md](../spark/2026-08-15-harness-core-design.md)
- **Architecture baseline**: [architecture-foundation.md](../architecture-foundation.md)
- **Glossary**: [glossary.md](../glossary.md)
- **ADRs**: [adr/](../adr/)

## Archived Prototype Guides

The original 13 feature guides describing `@yesimbot/harness-core` are preserved at:

- **[../archive/prototype-guides/](../archive/prototype-guides/)**

These show the evolution from prototype to canonical implementation.
