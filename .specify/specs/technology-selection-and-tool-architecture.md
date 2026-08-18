# Feature Specification: Technology Selection & Tool Architecture

**Feature Branch**: `technology-selection`

**Created**: 2026-08-18

**Status**: Draft

**Input**: Architecture discussion on technology stack choices (LLM layer, Cordis version, Satori vendor strategy, IM connectivity) and the tool context/registration/isolation model for Athena Harness.

> **Relation to prior specs**: Builds upon `satori-capability-architecture.md` (D-01~D-08) and `design-philosophy-and-positioning.md`. This spec covers the implementation-level technology choices and the tool subsystem design.

---

## Design Philosophy

Two consistent principles from earlier decisions apply to technology selection:

1. **Do not re-invent what a mature ecosystem already provides** — Satori for IM, AI SDK for LLM, Cordis for composition.
2. **Athena is an embedded kernel, not a standalone product** — it does not need its own public-facing abstractions for already-solved problems.

---

## Part I: Technology Stack Decisions

### D-09: LLM Layer Uses AI SDK v7 Directly

Pulse directly calls AI SDK v7's `generateText` / `streamText` / `tool` API. No intermediate LLM abstraction layer.

**Rationale**:
- AI SDK v7 provides multi-provider support (OpenAI, Anthropic, Google, Deepseek, etc.), tool calling, structured output, streaming — everything Pulse needs
- YesImBot v4's `agent-runtime` and prior `harness-core` were duplicating what AI SDK already provides
- Same logic as the Satori decision: mature ecosystem = use directly, don't wrap
- Pulse is the consumer; framework does not mediate between Pulse and AI SDK

**Dependency chain**:
```
Pulse → AI SDK v7 (generateText, streamText, tool) → provider packages (@ai-sdk/openai, @ai-sdk/anthropic, ...)
```

**What AI SDK v7 provides that removes the need for custom wrappers**:
- `contextSchema` + `toolsContext`: per-tool typed context injection
- `runtimeContext`: shared state across the agent loop
- `prepareStep`: dynamic context/tool updates between steps
- `ToolExecutionOptions.abortSignal`: native cancellation support
- Multi-step tool loops with configurable `maxSteps`

**Rejected alternatives**:
- Custom `AgentToolExecuteContext` wrapper (YesImBot v4 pattern) — AI SDK v7 now natively provides this
- Custom LLM abstraction layer (harness-core pattern) — duplicates AI SDK with less maturity
- MaiBot's `chat_key` indirect addressing — AI SDK's direct `toolsContext` is more type-safe

---

### D-10: Cordis v4 as Composition Substrate

Use Cordis v4 (`^4.0.0-rc.8`) as the DI/lifecycle/event foundation.

**Rationale**:
- v4 is Cordis's current development direction (Service improvements, Fiber lifecycle, better typing)
- deepseek-harness already validates Cordis v4 in production-grade agent systems
- Unified ecosystem with deepseek-harness enables knowledge transfer and possible code sharing

**Risk**: Cordis v4 is still RC (not semver-stable). Mitigated by: deepseek-harness proving it works; Satori v5 also targeting v4; Cordis v4 API surface unlikely to break significantly before release.

---

### D-11: Vendor Satori v5 Alpha from Git Main Branch

Vendor the following packages from `satorijs/satori` main branch:

| Package | Version | Role |
|---|---|---|
| `@satorijs/core` | 5.0.0-alpha.0 | Service, Bot, Adapter, Session |
| `@satorijs/protocol` | 2.0.0-alpha.0 | Methods, Event, Message types |
| `@satorijs/element` | 4.0.0-alpha.0 | Rich text content model |
| `@satorijs/adapter-satori` | 2.0.0-alpha.0 | Satori Protocol client adapter |

**npm dependencies** (already published, no need to vendor):
- `cordis` ^4.0.0-rc.8
- `@cordisjs/element` ^0.3.0
- `@cordisjs/plugin-http` ^1.3.0 (adapter-satori dependency)
- `cosmokit` ^1.8.1

**Rationale**:
- Satori v5 main branch has already completed the Cordis v3 → v4 migration (depends on `cordis: "^4.0.0-rc.3"`)
- Satori v5 is NOT published to npm (no `next` tag, no alpha release)
- Vendoring a git snapshot is the proven pattern (deepseek-harness vendors Cordis components)
- We control the version; upstream alpha changes don't break us unexpectedly
- 14 adapters already exist in v5 main (discord, telegram, qq, slack, etc.)

**Risk**: Alpha quality — potential incomplete features or breaking changes. Mitigated by: our use of Satori is limited to core + adapter-satori (bridge mode); we don't exercise the full adapter surface initially.

---

### D-12: IM Connectivity via Satori Protocol Bridge

Connect to IM platforms through Satori Protocol (HTTP + WebSocket), bridging to an existing Koishi instance.

**Architecture**:
```
Koishi Instance (Cordis v3 + Satori v4)
  ├── adapter-onebot (connects to Napcat/LLOneBot)
  ├── adapter-discord, adapter-telegram, ...
  └── @koishijs/plugin-server (exposes Satori Protocol API)
         │
         │  HTTP + WebSocket (Satori Protocol)
         ▼
Athena Runtime (Cordis v4 + Satori v5 vendor)
  └── @satorijs/adapter-satori 2.0.0-alpha.0
         → Bot instances appear in ctx.satori.bots
         → Events push through Cordis event system
         → Pulse consumes normally
```

**Rationale**:
- YesImBot v4 already runs as a Koishi plugin; Koishi natively supports `@koishijs/plugin-server`
- Zero modification to existing Koishi/adapter-onebot deployment
- Immediately gains all platforms Koishi supports
- Satori Protocol is a well-defined wire protocol (HTTP + WS + JSON), deployment-isolated
- `@satorijs/adapter-satori` 2.0.0-alpha.0 exists in v5 main branch, confirmed compatible

**Rejected alternatives**:
- Fork `koishi-plugin-adapter-onebot` for Satori v5 — viable long-term, but blocks short-term development
- Write new OneBot adapter from scratch — excessive work, duplicates community effort
- Run Satori v4 (Cordis v3) directly — context tree incompatibility with our Cordis v4 root

**Long-term evolution**: Once core is stable, can fork adapter-onebot or write native Satori v5 adapters to eliminate the Koishi bridge dependency.

---

### D-13: Athena Runtime is Not a Standalone Product

Athena Harness core is embedded as an internal dependency of `athena-runtime`. Not independently published.

**Rationale**:
- Framework serves specific products (YesImBot v4, World, Interlude)
- No need for generic packaging, independent versioning, or third-party developer ergonomics
- Simplifies development: internal breaking changes don't require semver ceremonies
- Can always extract later if demand emerges

---

## Part II: Tool Context Model

### D-14: No Tool Context Injection — Paradigm Shift from v3/v4

Athena's tool context model is fundamentally different from YesImBot v3/v4 because the agent isolation model changed.

**Paradigm comparison**:

| | YesImBot v3/v4 | Athena |
|---|---|---|
| Agent granularity | Per-channel isolated | Per-Spirit global |
| Bot relationship | One agent = one bot, one channel | One Pulse = multiple bots, all channels |
| "Current channel" | Implicit premise, always exists | Does not exist as a concept |
| Tool addressing | Injected/closure-bound target | LLM chooses target via parameters |
| Context injection motivation | Isolation = safety + simplification | No isolation needed = no injection needed |

**In Athena, the LLM is the decision-maker for addressing.** Tools receive complete addressing information as input parameters:

```typescript
// Athena: tool receives full addressing as LLM-provided input
defineTool({
  name: 'send_message',
  description: 'Send a message to a specified channel',
  parameters: {
    channelId: { type: 'string', required: true },
    content: { type: 'string', required: true },
    // Optional when single-bot; required when multi-bot
    botId: { type: 'string', description: 'platform:selfId, omit for default bot' },
  },
  async execute({ channelId, content, botId }, { signal }) {
    const bot = botId
      ? ctx.satori.bots.find(b => b.sid === botId)
      : ctx.satori.bots[0]
    await bot.createMessage(channelId, content)
    return { success: true }
  },
})
```

**Why this works in Athena but not in v3/v4**:
- v3/v4 agents were channel-scoped → injecting channelId prevented cross-channel operations (security)
- Athena Spirits are global → they NEED cross-channel operations ("reply in Discord based on QQ event")
- The LLM already knows the full context (events from all channels) → it can choose targets correctly
- Pulse controls the prompt to guide correct targeting

**Consequence**: AI SDK v7's `contextSchema` / `toolsContext` mechanism is NOT used for cross-plugin context injection. It may be used by Pulse internally for its own Layer 2 tools, but Layer 3 (plugin-contributed) tools are self-contained.

---

### D-15: Tools Access Services via Cordis Context

Tools access platform instances and services through the Cordis context they were registered in — not through injected parameters or closure-captured instances.

```typescript
// Plugin registers tool — tool accesses services via ctx
class OneBotUtilsPlugin {
  static inject = ['satori', 'tools']

  constructor(ctx: Context) {
    ctx.tools.register(defineTool({
      name: 'onebot.set_essence',
      description: 'Pin a message as group essence',
      parameters: {
        messageId: { type: 'string', required: true },
        botId: { type: 'string', description: 'platform:selfId' },
      },
      async execute({ messageId, botId }, { signal }) {
        // Access bot through Cordis context
        const bot = ctx.satori.bots.find(b => b.sid === botId)
        await bot.internal.setEssenceMsg(messageId)
        return { success: true }
      },
    }))
  }
}
```

**Rationale**:
- Cordis context is always available where the tool is registered
- No need for closure capture of specific instances — services are live references
- Lifecycle managed by Cordis (plugin dispose → tool unregistered automatically)
- Tools are effectively "thin functions" that translate LLM parameters into service calls

**What about `abortSignal`?**
- AI SDK v7 natively provides `abortSignal` in `ToolExecutionOptions` → no framework injection needed

---

### D-16: `ctx.tools` as Tool Registry Service

The framework provides a `ctx.tools` Cordis Service for tool registration, discovery, and execution.

**Core responsibilities**:
1. **Registration/unregistration** — plugins register tools; Cordis dispose auto-unregisters
2. **Discovery** — Pulse queries available tools when assembling the agent loop
3. **Execution** — unified execution entry point (enables hooks/guards in future)

**Interface sketch**:
```typescript
interface ToolRegistry extends Service {
  // Register a tool definition, returns dispose function
  register(definition: ToolDefinition): () => void

  // Get all tools visible from this context scope
  available(): ToolDefinition[]

  // Execute a tool call (called by agent loop)
  execute(call: ToolCall, options?: ExecuteOptions): Promise<ToolResult>
}
```

**Scope semantics** (following Cordis context tree):
- Tools registered at root context → visible to all Spirits
- Tools registered at Life context → visible only to that Spirit's Pulse
- Tools registered at Pulse context → visible only within that Pulse
- `available()` traverses up the context chain (local → life → global)

**Layer 2 tools** (Pulse-defined) may bypass `ctx.tools` entirely — Pulse can pass them directly to `generateText`. The registry is primarily for Layer 3 (plugin-contributed) tools.

**Relation to DSH**: Similar to deepseek-harness's `ctx.tools` pattern (register/execute pipeline) but without the Code Mode transport or UI presentation concerns. Athena's version is thinner — primarily lifecycle + scope.

---

## Part III: Configuration & Isolation Architecture

### D-17: Life Config — Per-Spirit Assembly Configuration

Each Spirit instance is assembled from a declarative **Life Config** — a Cordis plugin composition YAML that declares the complete makeup of one digital life.

**A Life Config contains**:
1. **Spirit** — persona definition, memory backend, identity
2. **Pulse** — which Pulse package to use (@athena/pulse-chat, @athena/pulse-world, ...)
3. **Media** — platform connections (adapter-satori endpoints, Minecraft server, ...)
4. **Plugins** — additional capability plugins (onebot-utils, draw-image, ...)
5. **Overrides** — parameter tuning (model selection, temperature, willingness thresholds, ...)

**Example** (`lives/alice.life.yml`):
```yaml
- id: spirit
  name: '@athena/spirit'
  config:
    persona: ./alice-persona.yml
    memory:
      backend: sqlite
      path: ./data/alice.db

- id: pulse
  name: '@athena/pulse-chat'
  config:
    model: deepseek-chat
    willingness:
      threshold: 0.6
      aggregationWindow: 3000

- id: medium-qq
  name: '@satorijs/adapter-satori'
  config:
    endpoint: http://localhost:5140
    token: xxx

- id: medium-discord
  name: '@satorijs/adapter-satori'
  config:
    endpoint: http://localhost:5141
    token: yyy

- id: onebot-tools
  name: '@athena/plugin-onebot-utils'
  config:
    enabledTools: [set_essence, ban_user]

- id: draw
  name: '@athena/plugin-draw'
```

**Multi-Spirit deployment** (root `cordis.yml`):
```yaml
- id: runtime
  name: '@athena/runtime'
  config:
    logLevel: info

- id: alice
  name: '@athena/life'
  config:
    compose: ./lives/alice.life.yml

- id: bob
  name: '@athena/life'
  config:
    compose: ./lives/bob.life.yml
```

**Relation to DSH concepts**:
| DSH | Athena | Scope |
|---|---|---|
| Profile | Life Config | Per-Spirit (Athena can have multiple; DSH has one per process) |
| Preset (agent composition) | Pulse + plugin subset within Life | Per-cognitive-session |
| Bundle (patch layer) | Future: shared plugin packs | Not designed yet |

**Rationale**:
- Leverages Cordis's native declarative configuration (same pattern as Koishi's `koishi.yml`)
- User decides plugin allocation per-Spirit through config — no code changes needed
- Clear mental model: "one YAML file = one digital life's complete setup"

---

### D-18: Tool Isolation via Cordis Context Tree

Tool visibility is naturally scoped by the Cordis context tree — no additional isolation mechanism needed.

**Mechanism**:
```
Root Context (global tools registered here)
├── read_resource, describe_image          ← visible to ALL Spirits
│
├── Alice Life Context (alice.life.yml)
│   ├── ctx.tools: onebot-utils, draw      ← only Alice sees these
│   ├── Spirit: Alice
│   └── ChatPulse
│       └── assembles: global + alice-scoped + Pulse Layer 2
│
└── Bob Life Context (bob.life.yml)
    ├── ctx.tools: onebot-utils             ← only Bob sees (no draw)
    ├── Spirit: Bob
    └── WorldPulse
        └── assembles: global + bob-scoped + Pulse Layer 2
```

**How it works**:
- Each Life Config instantiates as a Cordis child context (via `@athena/life` plugin)
- Plugins within that config register their tools to that child context's `ctx.tools`
- Pulse calls `ctx.tools.available()` which walks up the context chain
- Child context tools are NOT visible to sibling contexts (Cordis isolation guarantee)

**"Who decides Alice gets the draw plugin but Bob doesn't?"**:
→ The **user**, through Life Config. Alice's YAML lists `@athena/plugin-draw`; Bob's doesn't.

**Bot ownership and addressing**:
- Bots connected via adapters in Alice's Life Config belong to Alice's context
- In multi-Spirit deployments, Pulse's prompt context tells the LLM which bots/channels are "its own"
- Physical access control (preventing Alice's Pulse from using Bob's bot) is optional and future — initial deployments trust prompt-level guidance

---

### D-19: Pulse Internal Strategy Switching (Future — Deferred)

Within a single Pulse, different operational modes may use different tool/prompt combinations while keeping the same core cognitive loop.

**Examples**:
- Normal chat mode → full tool set + standard system prompt
- Rate-limited mode → restricted tools + minimal prompt
- Task mode → extended tools + task-specific prompt

**Current decision**: This is Pulse-internal implementation detail. Framework does not dictate how Pulse manages internal mode switching. Pulse has full control over what tools it passes to `generateText` on each invocation.

**Future consideration**: If patterns emerge, may formalize as a Pulse-level "preset" concept (analogous to DSH's agent presets). Deferred until Pulse contract is fully designed.

---

## Part IV: Historical Context — Why v3/v4 Patterns Don't Apply

### YesImBot v3 Tool Context

```typescript
// v3: session merged directly into tool parameters
interactions.register({
  name: 'ban_user',
  parameters: {
    session: SessionType,  // framework injects the triggering session
    user_id: z.string(),
  },
  execute: async ({ session, user_id }) => {
    await session.bot.internal.setGroupBan(session.guildId, user_id, 600)
  }
})
```

**Problem**: Tool is bound to a single session/channel. Cannot operate cross-channel.

### YesImBot v4 (agent-runtime) Tool Context

```typescript
// v4: AgentToolExecuteContext as second parameter
interface AgentToolExecuteContext {
  channel: ChannelMetadata      // current channel
  state: StateManager           // persistent state
  storage: StorageInterface     // file storage
  messages: Message[]           // conversation history
  abortSignal: AbortSignal      // cancellation
}
```

**Problem**: Assumes one channel per execution. World/Narrative Pulse aggregates multiple channels.

### YesImBot v4 (onebot-utils) Tool Context

```typescript
// v4 onebot-utils: factory function with closure binding
function createOneBotTools(ctx, bot, config, scope, resources) {
  return {
    set_essence: tool({
      execute: async ({ messageId }) => {
        // bot, scope captured via closure
        await bot.internal.setEssenceMsg(messageId)
      }
    })
  }
}
```

**Problem**: Tools bound to specific bot+scope at creation time. Cannot dynamically address different bots.

### Athena's Resolution

All three patterns share the assumption: **"one agent execution = one channel = one bot"**. Athena breaks this assumption at the architectural level:

- Spirit is global (not per-channel)
- Pulse may consume events from multiple channels simultaneously
- LLM decides which bot and channel to target
- Tools are stateless functions that receive complete addressing as parameters

Therefore, **no tool context injection is needed**.

---

## Open Questions

1. **Bot ownership enforcement**: Should the framework prevent Spirit A from using Spirit B's bots, or is prompt-level guidance sufficient?
2. **Tool description dynamism**: Should `ctx.tools` support dynamic descriptions (e.g., listing available bots/channels in tool description based on current state)?
3. **Execution hooks**: What pre/post-execution hooks does `ctx.tools` need? (Logging? Rate limiting? Permission checks?)
4. **Tool naming conventions**: Should plugin tools be namespaced (e.g., `onebot.set_essence`) or flat?
5. **Pulse contract with ctx.tools**: Exact API for Pulse to query and invoke Layer 3 tools — deferred to Pulse contract spec.
6. **Satori v5 vendor maintenance**: Process for tracking upstream changes and selectively merging updates.

---

## Decision Summary

| ID | Decision | Category |
|---|---|---|
| D-09 | LLM layer uses AI SDK v7 directly, no wrapper | Tech Stack |
| D-10 | Cordis v4 (^4.0.0-rc.8) as composition substrate | Tech Stack |
| D-11 | Vendor Satori v5 alpha from git main branch | Tech Stack |
| D-12 | IM connectivity via Satori Protocol bridge to Koishi | Tech Stack |
| D-13 | Athena Runtime is not a standalone product | Architecture |
| D-14 | No tool context injection — LLM addresses targets via parameters | Tool Model |
| D-15 | Tools access services via Cordis context (not injection) | Tool Model |
| D-16 | `ctx.tools` as Tool Registry Service (register/discover/execute) | Tool Model |
| D-17 | Life Config — per-Spirit declarative assembly (YAML) | Configuration |
| D-18 | Tool isolation via Cordis context tree scoping | Configuration |
| D-19 | Pulse internal strategy switching — deferred | Future |
