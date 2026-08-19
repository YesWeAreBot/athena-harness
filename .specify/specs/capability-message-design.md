# Design: `@athena-ai/capability-message`

**Created**: 2026-08-19

**Status**: Draft — Reviewed

**Input**: Deep analysis of cordis v4 isolation primitives, satori v5 alpha source (cordis v4), satori v4 stable (cordis v3), koishi core integration patterns, and existing athena-harness specs.

---

## Executive Summary

`@athena-ai/capability-message` provides IM interaction capability to the athena-harness framework. It wraps Satori v5 inside a cordis v4 **isolation domain**, exposing a scoped `ctx.message` service to the Life context. Cortex never sees `ctx.satori` or `ctx.bots` — it interacts exclusively through `ctx.message.*`.

This document covers:
1. Framework positioning: core vs capability vs plugin layering
2. Isolation domain architecture using cordis v4 primitives
3. Satori v5 compatibility assessment and fallback strategy
4. API surface design
5. Bot adapter registration pattern
6. Differentiation from Koishi

---

## Part I: Isolation Domain Architecture

### 1.1 The Problem

Satori v5 registers itself as a cordis Service on the key `'satori'`, and mixes `bots` and `component` onto the context:

```typescript
// @satorijs/core index.ts
export class Satori extends Service {
  constructor(ctx: Context) {
    super(ctx, 'satori')
    ctx.mixin('satori', ['bots', 'component'])
    // ...
  }
}
```

If Satori is installed directly on the Life context, `ctx.satori` and `ctx.bots` would be visible to all plugins — including Cortex. This violates our architectural principle: **Cortex depends on capability contracts (`message`), not implementation (`satori`)**.

### 1.2 Cordis v4 Isolation Primitives

Cordis v4 provides these relevant mechanisms (verified from source):

| Primitive | Source | Effect |
|---|---|---|
| `ctx.isolate(name, label?)` | `context.ts:65-69` | Creates a shadow of `[Context.isolate]` with a new symbol for `name`, making any service registered under that key invisible to ancestor/sibling contexts |
| `ctx.provide(name, value)` | `reflect.ts:175-203` | Registers a service implementation under the context's isolate symbol for `name` |
| `ctx.mixin(source, keys)` | `reflect.ts:239-265` | Creates accessor aliases on the context that delegate to a service |
| `Service` base class | `service.ts:18-35` | Constructor calls `ctx.reflect.provide(name, self)` |
| `[symbols.isolate]` dict | `context.ts:37` | Per-context prototype-chained dictionary mapping service names → symbols |

**Key insight from the source**: `ctx.isolate(name)` does NOT create a child context. It creates an extended context object with a prototype-shadowed `[symbols.isolate]` where `isolate[name]` points to a fresh symbol. Any service provided under that symbol is invisible to contexts using the original symbol.

```typescript
// context.ts:65-69
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

### 1.3 Isolation Strategy for MessageService

MessageService creates an **internal isolation domain** — a derived context where `satori` and `bots` resolve to private symbols, invisible to the outer Life context.

```
Life Context (ctx)
├── ctx.message = MessageService          ← visible to Cortex
│   │
│   └── [internal] this._inner = ctx.isolate('satori').isolate('bots')
│       ├── ctx.satori = Satori           ← hidden from Life
│       ├── ctx.bots = [Bot, Bot, ...]    ← hidden from Life
│       └── Adapter plugins installed here
│
├── Cortex (inject: ['message'])           ← sees ctx.message only
└── Other plugins                          ← cannot access ctx.satori
```

**Implementation sketch**:

```typescript
import { Context, Service } from 'cordis'
import Satori from '@satorijs/core'

export class MessageService extends Service {
  static readonly [Service.key] = 'message'
  static inject = []  // no external deps at startup
  
  private _inner: Context

  constructor(ctx: Context, public config: MessageService.Config) {
    super(ctx, 'message')
    
    // Create isolation domain — satori and bots are invisible outside
    this._inner = ctx.isolate('satori').isolate('bots')
    
    // Install Satori inside the isolation domain
    this._inner.plugin(Satori)
    
    // Forward events from isolation domain to parent
    // (Cordis events propagate up naturally — but we verify this)
    this._setupEventPropagation()
  }
}
```

### 1.4 Event Propagation and Scope Filtering

**Critical finding from Satori source** (`bot.ts:166-183`):

```typescript
// Bot.dispatch(session)
dispatch(session: Session) {
  // ...
  this.context.emit('internal/session', session)
  for (const event of events) {
    this.context.emit(session, event as any, session)
  }
}
```

Bot emits events on `this.context` — which is the isolated inner context. **Cordis v4 event filtering** works as follows:

```typescript
// EventsService._resolve() — the core dispatch logic
private _resolve(type, args) {
  const thisArg = /* first arg if object */
  const filter = thisArg?.[Context.filter]   // ← key mechanism
  return [thisArg, hooks
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
    .map(hook => hook.callback)]
}
```

- Each listener (`hook`) remembers the `ctx` it was registered on (`hook.ctx`)
- When an event is emitted with a `thisArg`, cordis checks `thisArg[Context.filter]`
- If `filter` exists, it is called with each `hook.ctx` — only passing hooks return `true`
- If `filter` is absent, ALL hooks receive the event (broadcast)

**Satori Session** does NOT define `[Context.filter]` by default:
```typescript
public [Service.tracker] = { associate: 'session', property: 'ctx' }
// No [Context.filter] → events broadcast to all listeners
```

### 1.4.1 The Multi-Life Problem

Without filtering, in a multi-Life deployment:
- Alice's Bot dispatches a `message` event
- Bob's Cortex (registered via `ctx.on('message', ...)`) would ALSO receive it
- This violates isolation: each Cortex should only receive events from its own MessageService

### 1.4.2 Solution: `[Context.filter]` Injection in MessageService

MessageService injects a scope-aware filter on every Session before it propagates:

```typescript
export class MessageService extends Service {
  constructor(ctx: Context, config) {
    super(ctx, 'message')
    this._inner = ctx.isolate('satori').isolate('bots')
    this._inner.plugin(Satori)

    // Inject scope filter on all sessions from this MessageService
    const messageSymbol = ctx[Context.isolate]['message']
    this._inner.on('internal/session', (session: Session) => {
      session[Context.filter] = (hookCtx: Context) => {
        return hookCtx[Context.isolate]['message'] === messageSymbol
      }
    })
  }
}
```

**How it works**:
- `ctx[Context.isolate]['message']` is the symbol that identifies THIS Life's message service
- When a listener is registered via `ctx.on('message', ...)`, cordis captures `hook.ctx`
- On dispatch, the filter checks: does the listener's context share the same `message` symbol?
- Same Life scope → same symbol → event delivered ✅
- Different Life scope → different symbol → event filtered ❌

### 1.4.3 Behavior by Deployment Mode

| Mode | `message` symbol | Effect |
|---|---|---|
| **v1: Single Life** | One global symbol (no isolate on `message`) | All listeners match → broadcast (same as no filter) |
| **v2: Multi Life** | Each group has `isolate: { message: true }` → private symbol per Life | Events scoped to owning Life's listeners only |

**Cortex does NOT need to self-filter**. The framework guarantees scope-correct event delivery.

### 1.4.4 Comparison with Koishi

Koishi uses the same mechanism for platform/channel filtering:
```typescript
// @koishijs/core/src/context.ts:128
satori.Session.prototype[Context.filter] = function(this: Session, ctx: Context) {
  return ctx.filter(this)  // FilterService checks platform/channel/user
}
```

Athena uses `[Context.filter]` for **scope isolation** (which Life owns this event) rather than content filtering (which channel). This is the correct granularity for a multi-Life framework.

### 1.5 Loader-Level Isolation (app.yml)

For deployments using `cordis run` with `app.yml`, the loader's isolation mechanism (`isolate.ts`) provides a YAML-declarative equivalent:

```yaml
- id: messaging
  name: '@athena-ai/capability-message'
  isolate:
    satori: true    # creates LocalRealm isolation
    bots: true
  config:
    # adapter configs nested below
```

However, **we prefer programmatic isolation inside MessageService** rather than relying on loader config because:
1. MessageService is responsible for its own encapsulation (defense-in-depth)
2. Users shouldn't need to know about Satori to configure isolation correctly
3. Programmatic approach works identically whether loaded via YAML or programmatic `ctx.plugin()`

---

## Part II: Satori v5 Compatibility Assessment

### 2.1 Version Comparison

| Aspect | Satori v4 (stable) | Satori v5 (alpha) |
|---|---|---|
| Cordis dependency | `^3.18.1` | `^4.0.0-rc.3` |
| npm published | Yes (`@satorijs/core@4.6.0`) | No (unreleased) |
| Service registration | `static [Service.provide] = 'satori'`<br>`static [Service.immediate] = true` | `super(ctx, 'satori')` (new v4 pattern) |
| Bot lifecycle | `static reusable = true` + manual `start()/stop()` | `* [Service.init]()` generator pattern |
| Context generic | `Satori<C extends Context>` | `Satori` (no generic, simpler) |
| InternalRouter | Custom HTTP method-based | Standard `Request`/`Response` API |
| HTTP integration | `ctx.on('http/file', ...)` | `ctx.on('http/fetch', ...)` |
| Adapter architecture | Same abstract pattern | Same abstract pattern |
| Bot.dispatch | Same event emission pattern | Same event emission pattern |

### 2.2 Viability Assessment

**Satori v5 IS viable with cordis v4.** Evidence:

1. **Dependency match**: Satori v5 declares `peerDependencies: { cordis: "^4.0.0-rc.3" }`. Our framework uses `cordis ^4.0.0-rc.8`. Compatible.

2. **Service registration works**: v5 uses `super(ctx, 'satori')` which calls `ctx.reflect.provide('satori', self)` — the standard cordis v4 pattern.

3. **Bot lifecycle uses v4 generators**: `* [Service.init]()` is the cordis v4 fiber initialization pattern. Verified in our cordis reference source.

4. **Isolation compatible**: `ctx.isolate('satori')` produces a fresh symbol. Satori's `super(ctx, 'satori')` registers under whatever symbol `ctx[symbols.isolate]['satori']` resolves to. Inside the isolated context, that's the private symbol → invisible outside.

5. **14 adapters already migrated**: telegram, discord, qq, slack, matrix, whatsapp, etc.

### 2.3 Known Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Alpha API instability | Medium | Vendor from git; we control the snapshot |
| `adapter-satori` HTTP dependency | Low | Only needs `@cordisjs/plugin-http` (published, stable) |
| Missing/incomplete adapter features | Low | Initial deployment uses only adapter-satori (bridge mode) |
| `Bot.init` generator may change | Low | Thin wrapper in MessageService can absorb changes |

### 2.4 Fallback Strategy

If Satori v5 proves unusable (unlikely given assessment above), the fallback is:

1. **Depend only on `@satorijs/protocol`** (type definitions: Methods, Event, Message, Channel, etc.)
2. **Depend on `@satorijs/element`** (rich text content model)
3. **Reimplement core**: Bot base class, Adapter lifecycle, Session, dispatch mechanism — these are ~400 lines of actual logic
4. **Fork adapters**: adapter-satori is ~200 lines; fork and adapt

This fallback is viable but unnecessary given the assessment above.

---

## Part III: API Surface Design

### 3.1 `ctx.message` — The Public Interface

Cortex and other consumers interact exclusively through `ctx.message`. The API is organized into:

```typescript
interface MessageService {
  // === Bot Registry ===
  /** All connected bots, addressable by sid (platform:selfId) */
  readonly bots: Bot[] & Dict<Bot>
  
  // === Convenience Methods (delegates to appropriate Bot) ===
  /** Send a message. If botSid omitted and only one bot, uses default. */
  createMessage(channelId: string, content: Fragment, botSid?: string): Promise<Message[]>
  sendMessage(channelId: string, content: Fragment, botSid?: string): Promise<string[]>
  sendPrivateMessage(userId: string, content: Fragment, guildId?: string, botSid?: string): Promise<string[]>
  
  // === Type Re-exports (for tool/cortex use) ===
  // @satorijs/protocol types re-exported:
  //   Message, Channel, Guild, User, GuildMember, Event, etc.
  // @satorijs/element re-exported:
  //   h (element builder), Fragment, Element
}
```

### 3.2 Design Rationale for API Shape

**Why expose `bots` directly?**
- Cortex needs to address specific bots in multi-bot scenarios
- Bot objects carry `platform`, `selfId`, `features`, `status` — essential for Cortex decision-making
- Satori Bot implements full `Methods` interface — Cortex can call `bot.getMessageList()`, `bot.getGuild()`, etc. directly
- No need to proxy 40+ Methods through MessageService

**Why add convenience methods on MessageService?**
- Single-bot deployments (majority case) shouldn't require explicit bot selection
- `ctx.message.createMessage(channelId, content)` is the simplest API for tools
- Convenience methods handle bot resolution: default if one bot, error if ambiguous without `botSid`

**Why NOT wrap Bot in a proprietary type?**
- Satori Bot IS the standard. Wrapping it adds indirection without value.
- Cortex developers learning Satori Bot API learn a transferable skill
- `bot.features` already provides capability negotiation
- Types from `@satorijs/protocol` are already the industry-standard IM abstraction

### 3.3 Event Contract

Events propagate via cordis event system. Cortex subscribes normally:

```typescript
// In Cortex implementation
ctx.on('message', (session: Session) => {
  // session.bot — the Bot that received this
  // session.channelId, session.userId, session.content, etc.
  // session.elements — rich content as Element[]
  this.handleIncoming(session)
})

ctx.on('message-created', (session) => { /* alias */ })
ctx.on('message-updated', (session) => { /* edits */ })
ctx.on('message-deleted', (session) => { /* deletions */ })
ctx.on('reaction-added', (session) => { /* reactions */ })
ctx.on('guild-member-added', (session) => { /* joins */ })
// ... full Satori event set
```

**No event wrapping or normalization**: Cortex receives raw Satori Sessions. This is intentional — Sessions are already well-structured with accessors for `channelId`, `userId`, `platform`, `content`, etc.

### 3.4 Dependency Declaration

Cortex declares messaging dependency via cordis `inject`:

```typescript
export class CortexChat extends Service {
  static inject = ['message']  // requires messaging capability
  
  constructor(ctx: Context) {
    super(ctx, 'cortex')
    // ctx.message is guaranteed available here
  }
}
```

Cordis ensures CortexChat only activates when MessageService is provided.

---

## Part IV: Bot Adapter Registration Pattern

### 4.1 How Adapters Are Installed

Adapters are standard Satori adapter plugins. They are installed **inside MessageService's isolation domain**. MessageService exposes a method for this:

```typescript
export class MessageService extends Service {
  // ...
  
  /** Install an adapter plugin into the messaging isolation domain */
  adapter(plugin: Plugin, config?: any): () => void {
    return this._inner.plugin(plugin, config)
  }
}
```

**For YAML-based deployment** (primary pattern), adapters are declared as nested config:

```yaml
# instances/alice.yml
- id: life
  name: '@athena-ai/plugin-life'
  config:
    persona: ./alice-persona.yml

- id: messaging
  name: '@athena-ai/capability-message'
  config:
    adapters:
      - name: '@satorijs/adapter-satori'
        config:
          endpoint: 'http://localhost:5140'
          token: 'my-token'
      # Second adapter (optional)
      - name: '@satorijs/adapter-satori'
        config:
          endpoint: 'http://koishi-discord:5140'
          token: 'discord-token'

- id: cortex
  name: '@athena-ai/cortex-chat'
  config:
    model: deepseek-chat
```

MessageService reads `config.adapters` and installs each into its internal isolation domain.

### 4.2 Adapter Lifecycle

```
MessageService.constructor(ctx, config)
  │
  ├── this._inner = ctx.isolate('satori').isolate('bots')
  ├── this._inner.plugin(Satori)     → ctx.satori available inside _inner
  │
  └── for each adapter in config.adapters:
        this._inner.plugin(AdapterPlugin, adapterConfig)
          │
          └── Adapter creates Bot instances
              Bot.constructor pushes to ctx.bots (= _inner.bots)
              Bot.[Service.init]() → Bot.start() → Bot.connect()
              Bot.dispatch(session) → events propagate to Life ctx
```

**Dispose cascade**:
- MessageService disposed → `_inner` context disposed → all adapters disposed → all bots stopped
- Single adapter disposed → its bots removed from `_inner.bots` → `login-removed` event emitted

### 4.3 Hot-Add Adapters at Runtime

Programmatic hot-add:
```typescript
// Later, in some management plugin:
const dispose = ctx.message.adapter(AdapterTelegram, { token: '...' })
// Later:
dispose()  // removes the adapter and its bots
```

This supports the "add platform connections without restart" use case.

### 4.4 Adapter Compatibility

Existing Satori v5 adapters require NO modification:
- They call `super(ctx, bot, config)` using the `ctx` from the isolation domain
- They register Bots into `ctx.bots` (which resolves to the isolation's `bots`)
- They dispatch events via `bot.dispatch(session)` which emits on the isolation's context → propagates up

---

## Part V: Architecture Diagram

```
┌─ Athena Runtime (Cordis v4 Root Context) ─────────────────────────────────────────┐
│                                                                                    │
│  ┌─ Life Context ──────────────────────────────────────────────────────────────┐   │
│  │                                                                              │   │
│  │  Spirit (persona, memory, self-model)                                        │   │
│  │                                                                              │   │
│  │  ┌─ ctx.message (MessageService) ──────────────────────────────────────┐    │   │
│  │  │                                                                      │    │   │
│  │  │  PUBLIC API:                                                         │    │   │
│  │  │    .bots → [Bot, Bot, ...] (proxy, sid-addressable)                 │    │   │
│  │  │    .createMessage(channelId, content, botSid?)                       │    │   │
│  │  │    .sendMessage(channelId, content, botSid?)                         │    │   │
│  │  │    .sendPrivateMessage(userId, content, guildId?, botSid?)           │    │   │
│  │  │                                                                      │    │   │
│  │  │  ┌─ ISOLATION DOMAIN (invisible to Life ctx) ──────────────────┐    │    │   │
│  │  │  │  _inner = ctx.isolate('satori').isolate('bots')              │    │    │   │
│  │  │  │                                                              │    │    │   │
│  │  │  │  ctx.satori (Satori Service)  ← HIDDEN                      │    │    │   │
│  │  │  │  ctx.bots   [Bot, Bot, ...]   ← HIDDEN                      │    │    │   │
│  │  │  │                                                              │    │    │   │
│  │  │  │  ┌── Adapter: @satorijs/adapter-satori ──────────────┐      │    │    │   │
│  │  │  │  │  Bot: onebot:12345  (QQ via Koishi bridge)         │      │    │    │   │
│  │  │  │  │  Bot: discord:67890 (Discord via Koishi bridge)    │      │    │    │   │
│  │  │  │  └───────────────────────────────────────────────────┘      │    │    │   │
│  │  │  │                                                              │    │    │   │
│  │  │  │  Events: bot.dispatch(session) ─── propagates UP ──────────►│    │    │   │
│  │  │  └──────────────────────────────────────────────────────────────┘    │    │   │
│  │  └──────────────────────────────────────────────────────────────────────┘    │   │
│  │                                                                              │   │
│  │  ┌─ Cortex (inject: ['message']) ──────────────────────────────────────┐    │   │
│  │  │  ctx.on('message', session => this.handleIncoming(session))          │    │   │
│  │  │  ctx.message.createMessage(channelId, reply)                         │    │   │
│  │  │  ctx.message.bots['onebot:12345'].getGuildMemberList(...)            │    │   │
│  │  │                                                                      │    │   │
│  │  │  ❌ ctx.satori → undefined (isolated)                               │    │   │
│  │  │  ❌ ctx.bots   → undefined (isolated)                               │    │   │
│  │  └──────────────────────────────────────────────────────────────────────┘    │   │
│  │                                                                              │   │
│  └──────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                    │
└────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Part VI: Differentiation from Koishi

### 6.1 Koishi's Integration Pattern

Koishi makes Satori the **foundational substrate**. Its `Context` class literally extends `satori.Context`:

```typescript
// @koishijs/core/src/context.ts:50
export class Context extends satori.Context { ... }
```

This means:
- Every Koishi context IS a Satori context
- `ctx.satori`, `ctx.bots` are available everywhere, to every plugin
- The framework identity IS messaging — you cannot use Koishi without Satori
- Bot lifecycle, session handling, middleware chain all assume IM as the core flow

### 6.2 Athena's Integration Pattern

Athena treats Satori as a **pluggable capability implementation**:

| Aspect | Koishi | Athena |
|---|---|---|
| Context inheritance | `Context extends satori.Context` | `Context` is vanilla cordis; Satori isolated inside |
| Satori visibility | Global (`ctx.satori` everywhere) | Hidden (inside MessageService isolation) |
| Bot access | `ctx.bots` on every context | `ctx.message.bots` only |
| Framework identity | IS a messaging framework | HAS messaging capability |
| Without messaging | Cannot function | Functions fine (other capabilities, autonomous rhythm) |
| Messaging removal | Impossible | Remove MessageService plugin → framework continues |
| Adding non-IM | Bolted on top of messaging | Equal-status sibling capability |

### 6.3 Concrete Differentiation Points

1. **Messaging is optional**: Athena can run a World Cortex with only `ctx.minecraft` — no MessageService installed, no Satori in the process. This is architecturally impossible in Koishi.

2. **Isolation prevents shape leakage**: In Koishi, every plugin can do `ctx.bots[0].sendMessage(...)` — the framework is "satori-shaped" at every level. In Athena, only code that explicitly declares `inject: ['message']` gets access.

3. **Multiple capability parity**: `ctx.message`, `ctx.minecraft`, `ctx.audio` are structurally identical — each a Service with internal isolation. In Koishi, messaging is privileged infrastructure; non-messaging capabilities are second-class afterthoughts.

4. **No event→response pipeline**: Koishi provides middleware chain, command routing, and session management that ALL assume "message in → process → message out." Athena provides zero IM-specific framework flow. Cortex entirely self-determines how to respond (or not respond).

5. **Framework boots without messaging**: Cordis root → Life → Cortex can all activate without MessageService if Cortex doesn't inject it. Koishi CANNOT construct its Context without Satori.

---

## Part VII: Implementation Plan Sketch

### 7.1 Package Structure

```
packages/capability/message/
├── src/
│   ├── index.ts          ← exports MessageService, re-exports types
│   ├── service.ts        ← MessageService class
│   └── types.ts          ← type re-exports from @satorijs/protocol + element
├── package.json
└── tsconfig.json
```

### 7.2 Dependencies

```json
{
  "name": "@athena-ai/capability-message",
  "peerDependencies": {
    "cordis": "^4.0.0-rc.8"
  },
  "dependencies": {
    "@satorijs/core": "workspace:*",
    "@satorijs/protocol": "workspace:*",
    "@satorijs/element": "workspace:*",
    "cosmokit": "^1.8.1"
  }
}
```

Satori packages come from `vendor/satori/` (vendored from git, workspace-linked).

### 7.3 Core Implementation (~150 lines)

```typescript
import { Context, Service } from 'cordis'
import { Dict } from 'cosmokit'
import Satori, { Bot, Session } from '@satorijs/core'
import * as h from '@satorijs/element'
import { Fragment, Message, SendOptions } from '@satorijs/protocol'

export { Bot, Session, h }
export * as Universal from '@satorijs/protocol'

export interface MessageServiceConfig {
  adapters?: Array<{
    name: string
    config?: any
  }>
}

export class MessageService extends Service {
  static [Service.provide] = 'message'
  
  private _inner: Context

  constructor(ctx: Context, public config: MessageServiceConfig = {}) {
    super(ctx, 'message')
    
    // Create isolation domain
    this._inner = ctx.isolate('satori').isolate('bots')
    
    // Install Satori inside isolation
    this._inner.plugin(Satori)
    
    // Install configured adapters
    for (const adapter of config.adapters ?? []) {
      this._loadAdapter(adapter.name, adapter.config)
    }
  }

  /** Bots registry — proxy to internal Satori bots */
  get bots(): Bot[] & Dict<Bot> {
    return this._inner.satori?.bots ?? ([] as any)
  }

  /** Install an adapter into the isolation domain */
  adapter(plugin: any, config?: any): () => void {
    return this._inner.plugin(plugin, config)
  }

  /** Send a message (convenience, resolves bot) */
  async createMessage(
    channelId: string,
    content: h.Fragment,
    botSid?: string,
    options?: SendOptions
  ): Promise<Message[]> {
    const bot = this._resolveBot(botSid)
    return bot.createMessage(channelId, content, undefined, options)
  }

  /** Send and return message IDs */
  async sendMessage(
    channelId: string,
    content: h.Fragment,
    botSid?: string,
    options?: SendOptions
  ): Promise<string[]> {
    const bot = this._resolveBot(botSid)
    return bot.sendMessage(channelId, content, undefined, options)
  }

  /** Send private message */
  async sendPrivateMessage(
    userId: string,
    content: h.Fragment,
    guildId?: string,
    botSid?: string,
    options?: SendOptions
  ): Promise<string[]> {
    const bot = this._resolveBot(botSid)
    return bot.sendPrivateMessage(userId, content, guildId, options)
  }

  private _resolveBot(sid?: string): Bot {
    if (sid) {
      const bot = this.bots[sid]
      if (!bot) throw new Error(`Bot not found: ${sid}`)
      return bot
    }
    const active = this.bots.filter(b => b.isActive)
    if (active.length === 0) throw new Error('No active bots available')
    if (active.length === 1) return active[0]
    throw new Error(
      `Multiple bots available (${active.map(b => b.sid).join(', ')}); specify botSid`
    )
  }

  private async _loadAdapter(name: string, config?: any) {
    try {
      const mod = await import(name)
      const plugin = mod.default ?? mod
      this._inner.plugin(plugin, config)
    } catch (e) {
      this.ctx.logger('message').error(`Failed to load adapter: ${name}`, e)
    }
  }
}

export default MessageService
```

### 7.4 Usage Examples

**Cortex consuming messaging:**
```typescript
export class CortexChat extends Service {
  static inject = ['message']
  
  constructor(ctx: Context) {
    super(ctx, 'cortex')
    
    ctx.on('message', (session) => {
      // session.channelId, session.content, session.bot.sid
      this.onMessage(session)
    })
  }
  
  async onMessage(session: Session) {
    // ... LLM processing ...
    await this.ctx.message.createMessage(
      session.channelId,
      'Hello!',
      session.bot.sid  // reply via same bot
    )
  }
}
```

**LLM Tool using messaging:**
```typescript
const sendMessageTool = defineTool({
  name: 'send_message',
  description: 'Send a message to a channel',
  parameters: {
    channelId: { type: 'string', required: true },
    content: { type: 'string', required: true },
    botSid: { type: 'string', description: 'Bot to use (platform:selfId)' },
  },
  async execute({ channelId, content, botSid }) {
    const ids = await ctx.message.sendMessage(channelId, content, botSid)
    return { messageIds: ids }
  }
})
```

---

## Part VIII: Open Questions

### Resolved by This Design

| Question | Resolution |
|---|---|
| How does isolation work? | `ctx.isolate('satori').isolate('bots')` — cordis v4 native |
| Do events cross isolation? | Events propagate across service isolation boundaries, but are **scoped** via `[Context.filter]` injection. MessageService attaches a filter to each Session matching on the `message` isolate symbol — ensuring events only reach listeners in the same Life scope. |
| Is Satori v5 compatible? | Yes — depends on cordis `^4.0.0-rc.3`, uses v4 Service patterns |
| How are adapters installed? | Inside MessageService's isolation domain, either via config or `ctx.message.adapter()` |
| What does Cortex see? | Only `ctx.message` (MessageService). Cannot access `ctx.satori` or `ctx.bots` |

### Remaining Open

| Question | Notes |
|---|---|
| Layer 3 tool registration | How do adapter-specific tools get exposed to LLM? Deferred (D-08). |
| Multi-Life bot sharing | Two Lives using the same Bot instance? Deferred to v2. |
| Event filtering per-Life | **Resolved**: `[Context.filter]` injected by MessageService on `internal/session` event. Filter matches `ctx[Context.isolate]['message']` symbol. Same scope → delivered; different scope → filtered. |
| `@cordisjs/plugin-http` availability | **Resolved**: HTTP is shared infrastructure in app.yml (not isolated). `ctx.isolate('satori')` only affects the `satori` key — HTTP remains accessible inside the isolation domain because its symbol is inherited via prototype chain. |
| Hot-reload of adapter config | Config change → restart adapter? Leverage cordis HMR? |

---

## Part IX: Summary of Decisions

| # | Decision | Rationale |
|---|---|---|
| M-01 | MessageService uses `ctx.isolate('satori').isolate('bots')` for internal domain | Cordis-native; hides implementation from consumers |
| M-02 | Events scoped via `[Context.filter]` injection on Session | MessageService injects filter matching on `message` isolate symbol; multi-Life events don't leak across scopes |
| M-03 | `ctx.message.bots` exposes Bot[] directly (no wrapping) | Satori Bot IS the standard; wrapping adds no value |
| M-04 | Convenience methods on MessageService for common operations | Single-bot UX; tools don't need bot selection logic |
| M-05 | Adapters installed via `config.adapters` array or `ctx.message.adapter()` | Declarative + programmatic; supports hot-add |
| M-06 | Satori v5 alpha is the target (vendor from git) | Compatible with cordis v4; v4 stable requires cordis v3 (incompatible) |
| M-07 | Fallback: protocol-only + reimpl core (if v5 unusable) | Viable but unlikely needed; ~400 lines of core logic |
| M-08 | No proprietary event wrapper | Satori Session is already well-structured; no added value in wrapping |
| M-09 | Cortex declares `inject: ['message']` — never `['satori']` | Capability contract, not implementation |
| M-10 | Framework can function without messaging | MessageService is optional; non-IM Cortices don't need it |

---

## Part X: Framework Positioning — Core / Capability / Plugin Layering

### 10.1 The Question

Cordis has a tradition: anything loadable via `ctx.plugin()` is a "plugin," typically named `plugin-xxx`. If `@athena-ai/core` is also loaded via `ctx.plugin()`, does that make Athena merely "a plugin of cordis" — the same relationship as YesImBot to Koishi?

### 10.2 The Distinction: Prelude vs Managed Plugin

Cordis loaders distinguish two categories of plugin installations:

| Category | Loaded when | Managed by | User can uninstall? | Example |
|---|---|---|---|---|
| **Prelude** | Before loader parses `app.yml` | Hardcoded in `cordis.yml` / CLI | ❌ Not visible in WebUI | `plugin-env`, `plugin-logger-console` |
| **Managed plugin** | After loader starts, from `app.yml` | Loader + WebUI | ✅ Can disable/remove via UI | `plugin-database`, `plugin-server` |

**Athena core is a prelude-level installation.** It is loaded before the managed plugin tree, not visible in plugin management UI, and cannot be "uninstalled" in any meaningful sense.

### 10.3 Three-Layer Runtime Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Layer 0: Cordis (DI/lifecycle infrastructure)                   │  ← Library, invisible
├─────────────────────────────────────────────────────────────────┤
│  Layer 1: @athena-ai/core (framework kernel)                     │  ← Prelude, not unloadable
│    · Cortex base class (one-per-Life enforcement)                 │
│    · Hook protocol definitions                                   │
│    · LifeService / MemoryProvider interfaces                     │
│    · Capability design patterns (documentation)                  │
├─────────────────────────────────────────────────────────────────┤
│  Layer 2: app.yml managed plugin tree                            │  ← User-configurable
│    · @athena-ai/capability-message (provides 'message')           │
│    · @athena-ai/cortex-chat (inject: ['message'])                 │
│    · @satorijs/adapter-satori (inside message isolation)          │
│    · @cordisjs/plugin-database-sqlite                             │
│    · @athena-ai/plugin-memory                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 10.4 Analogy with Koishi

```
Koishi ecosystem:                    Athena ecosystem:
─────────────────                    ─────────────────
cordis (library)                     cordis (library)
@koishijs/core (prelude, kernel)     @athena-ai/core (prelude, kernel)
koishi start (branded CLI)           cordis run (reuse cordis CLI; own CLI deferred)
app.yml plugins (unloadable)         app.yml plugins (unloadable)
```

The structural relationship to cordis is **identical to Koishi's relationship to cordis**:
- Cordis is a library (not a host)
- Core is loaded as prelude (technically a plugin, semantically the framework)
- Users manage capabilities/cortex/adapters in `app.yml`
- Branded CLI is deferred; the architecture supports it without changes

The **identity difference** from Koishi:
- Koishi core inherits `satori.Context` → framework identity = messaging
- Athena core does NOT inherit `satori.Context` → framework identity = digital life
- Messaging is a Layer 2 managed plugin, not part of the kernel

### 10.5 CLI Entry Point Design

**Current stage**: Use cordis CLI directly. No custom `@athena-ai/cli` package.

```yaml
# cordis.yml — standard cordis bootstrap
- name: '@cordisjs/plugin-cli'
  config:
    name: athena
- name: '@cordisjs/plugin-cli-cordis'
  config:
    path: ./app.yml
    daemon:
      enabled: true
    prelude:
      - name: '@athena-ai/core'
      - name: '@cordisjs/plugin-logger-console'
```

```bash
# User experience (current)
cordis run              # or: yarn dev
```

**Why this is sufficient**:
- `@athena-ai/core` is in prelude → not unloadable, not visible in WebUI plugin management
- All cordis ecosystem plugins (HMR, webui, database, market) work as-is in app.yml
- Daemon mode (auto-restart, heartbeat) provided by `plugin-cli-cordis`
- No engineering effort on CLI packaging; focus on framework substance

**Future option (deferred)**: A branded `athena start` CLI wrapping cordis loader. The prelude mechanism is identical — only the entry point binary changes. This can be added later without any architectural change.


### 10.6 Independence Without Custom CLI

The independence criterion shifts from "branded CLI" to "prelude-level kernel that defines framework identity":

| Criterion | YesImBot (❌ not independent) | Athena (✅ independent) |
|---|---|---|
| Core location | app.yml (managed, unloadable by user) | prelude (kernel, not unloadable) |
| Framework identity | One plugin among many in Koishi | THE prelude that all other plugins depend on |
| Without it | Koishi still works | Process has no purpose (all plugins inject core services) |
| Ecosystem relationship | Consumer of Koishi ecosystem | Peer of Koishi (both are cordis-based frameworks) |
| Entry point | `koishi start` | `cordis run` (current) / `athena start` (future) |

**The test remains the same**: Remove `@athena-ai/core` from prelude → all capability/cortex plugins fail to activate (unmet inject dependencies) → process is an empty shell. Core IS the framework.


### 10.7 Package Naming Rationale

| Package | Name | Why not `plugin-xxx`? |
|---|---|---|
| Framework kernel | `@athena-ai/core` | Same as `@koishijs/core`, `@satorijs/core` — it's the framework, not a feature |
| ~~CLI~~ | ~~`@athena-ai/cli`~~ | Deferred. Using cordis CLI directly for now. |
| Messaging capability | `@athena-ai/capability-message` | It IS a plugin (managed, unloadable), but named by domain role not "plugin-" prefix |
| Cortex | `@athena-ai/cortex-chat` | Domain concept carries type info; `plugin-` redundant |
| Generic utilities | `@athena-ai/plugin-memory` | Truly generic plugins use `plugin-` prefix (per D-22) |

### 10.8 Decisions

| # | Decision | Rationale |
|---|---|---|
| M-11 | `@athena-ai/core` is loaded as prelude, not in managed app.yml | Kernel cannot be "uninstalled"; same pattern as @koishijs/core |
| M-12 | Use cordis CLI directly; custom `athena start` CLI deferred | No engineering overhead; prelude mechanism provides independence regardless of CLI brand |
| M-13 | Core does NOT extend/inherit satori Context | Framework identity ≠ messaging; differentiation from Koishi |
| M-14 | Cordis ecosystem plugins (HMR, webui, database) are fully reusable | They install in app.yml as managed plugins alongside athena capabilities |

---

## Part XI: Core Architecture — `@athena-ai/core` and `@athena-ai/plugin-life`

### 11.1 Separation of Concerns

The framework kernel is split into two packages with distinct roles:

| Package | Location | Provides | Runtime service? |
|---|---|---|---|
| `@athena-ai/core` | prelude (not unloadable) | Cortex base class, hook protocol declarations, LifeService interface, MemoryProvider interface | ❌ No — types + base classes only |
| `@athena-ai/plugin-life` | app.yml / instance (managed) | `ctx.life` runtime service (persona, memory, one-Cortex enforcement) | ✅ Yes — provides `'life'` |

**Why separate**:
- Core is framework metadata — every athena plugin implicitly depends on its types/base classes
- plugin-life is a runtime instance — installed once per Life scope, holds concrete persona and memory
- In multi-Life scenarios, plugin-life is installed multiple times (once per isolated scope); core remains singular in prelude

### 11.2 `@athena-ai/core` — Contents

Core is intentionally thin (v1). It exports:

```typescript
// @athena-ai/core/src/index.ts
import { Service, Context } from 'cordis'

// === Cortex Base Class ===
// Enforces one-per-Life constraint via ctx.life.registerCortex()
export abstract class Cortex extends Service {
  static inject = ['life']

  constructor(ctx: Context, name: string) {
    super(ctx, name)
  }

  // Cordis v4 fiber init generator — handles registration + cleanup
  *[Service.init]() {
    this.ctx.life.registerCortex(this)
    yield () => this.ctx.life.unregisterCortex(this)
  }
}

// === Memory Interface ===
export interface MemoryProvider {
  store(key: string, value: any): Promise<void>
  retrieve(key: string): Promise<any>
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>
}

export interface SearchOptions {
  limit?: number
  threshold?: number
}

export interface MemoryEntry {
  key: string
  value: any
  score?: number
}

// === Life Service Interface ===
export interface LifeService {
  readonly persona: Persona
  readonly memory: MemoryProvider
  registerCortex(cortex: Service): void
  unregisterCortex(cortex: Service): void
}

export interface Persona {
  name: string
  description: string
  traits: Record<string, any>
  [key: string]: any
}

// === Hook Protocol ===
declare module 'cordis' {
  interface Context {
    life: LifeService
  }

  interface Events {
    'cortex/before-drain'(events: any[]): any[]
    'cortex/after-integrate'(context: any): any
    'cortex/before-cognition'(params: any): any
    'cortex/before-enact'(actions: any): boolean | void
    'cortex/after-enact'(results: any): void
  }
}
```

**Core does NOT**:
- Provide any runtime service (no `ctx.provide(...)` call)
- Depend on capability-message or any capability
- Depend on AI SDK or any LLM infrastructure
- Include Instance loading logic

### 11.3 `@athena-ai/plugin-life` — Contents

plugin-life is the runtime implementation of LifeService:

```typescript
// @athena-ai/plugin-life/src/index.ts
import { Context, Service } from 'cordis'
import { LifeService, Persona, MemoryProvider } from '@athena-ai/core'

export class Life extends Service implements LifeService {
  static [Service.provide] = 'life'

  public persona: Persona
  public memory: MemoryProvider
  private _cortex: Service | null = null

  constructor(ctx: Context, public config: Life.Config) {
    super(ctx, 'life')
    this.persona = this._loadPersona(config.persona)
    this.memory = this._initMemory(config.memory)
  }

  registerCortex(cortex: Service) {
    if (this._cortex) {
      throw new Error(
        `Only one Cortex per Life. Current: ${this._cortex.name}, ` +
        `attempted: ${cortex.name}`
      )
    }
    this._cortex = cortex
  }

  unregisterCortex(cortex: Service) {
    if (this._cortex === cortex) this._cortex = null
  }

  private _loadPersona(path: string): Persona { /* load from YAML */ }
  private _initMemory(config: any): MemoryProvider { /* init backend */ }
}

export namespace Life {
  export interface Config {
    persona: string   // path to persona YAML
    memory: {
      backend: 'sqlite' | 'memory' | string
      path?: string
    }
  }
}

export default Life
```

### 11.4 Dependency Graph

```
cordis (peer dep for all)
  ↑
@athena-ai/core                         ← types + base classes (prelude)
  ↑                        ↑
@athena-ai/plugin-life     │            ← provides ctx.life (runtime)
  (inject: [])             │
                           │
@athena-ai/capability-message            ← provides ctx.message (runtime)
  (inject: [], NO dep on core)           (depends only on cordis + satori)
                           │
                    ↑      ↑
@athena-ai/cortex-chat                   ← inject: ['life', 'message']
  (depends on core for Cortex base class)
```

**Key rule**: capability-message has NO dependency on core. It is a pure cordis + satori package. The connection happens at the Cortex level, which injects both.

### 11.5 One-Cortex Enforcement Mechanism

The constraint "at most one Cortex per Life" is enforced by:

1. **Cortex base class** (from core) calls `ctx.life.registerCortex(this)` in constructor
2. **LifeService** (from plugin-life) throws if `_cortex` is already set
3. **Cordis inject** ensures Cortex only activates when `ctx.life` is available
4. **Cordis dispose** propagation: when Cortex is disposed, `unregisterCortex` is called

If a user installs two Cortex plugins in the same Life scope, the second one's constructor throws → cordis marks it as failed. Clear error message.

---

## Part XII: Instance Mechanism

### 12.1 What is an Instance?

An Instance is a **declarative YAML file** describing the complete composition of one digital life. It is implemented using cordis's standard `plugin-include` mechanism — no custom loader needed.

### 12.2 File Structure

```
athena-harness/
├── cordis.yml                    ← bootstrap (prelude: core)
├── app.yml                       ← managed plugin tree
├── instances/
│   ├── alice.yml                 ← Alice's instance definition
│   └── bob.yml                   ← Bob's instance definition (future)
├── personas/
│   ├── alice-persona.yml         ← Alice's character definition
│   └── bob-persona.yml
└── data/
    ├── alice.db                  ← Alice's memory storage
    └── bob.db
```

### 12.3 v1: Single Life (No Isolation Needed)

```yaml
# app.yml
- name: '@cordisjs/plugin-include'
  config:
    path: ./instances/alice.yml

# Shared infrastructure
- name: '@cordisjs/plugin-database-sqlite'
  config:
    path: ./data/athena.db
- name: '@cordisjs/plugin-hmr'
  config:
    root: [packages, instances]
- name: '@cordisjs/plugin-webui'
```

```yaml
# instances/alice.yml — one complete Life
- name: '@athena-ai/plugin-life'
  config:
    persona: ./personas/alice-persona.yml
    memory:
      backend: sqlite
      path: ./data/alice.db

- name: '@athena-ai/capability-message'
  config:
    adapters:
      - name: '@satorijs/adapter-satori'
        config:
          endpoint: 'http://localhost:5140'
          token: 'my-token'

- name: '@athena-ai/cortex-chat'
  config:
    model: deepseek-chat
    willingness:
      threshold: 0.6
      aggregationWindow: 3000
```

### 12.4 v2: Multiple Lives (Cordis Isolate)

```yaml
# app.yml — multi-Life deployment
- name: '@cordisjs/plugin-group'
  label: Alice
  isolate:
    life: true
    message: true
  config:
    - name: '@cordisjs/plugin-include'
      config:
        path: ./instances/alice.yml

- name: '@cordisjs/plugin-group'
  label: Bob
  isolate:
    life: true
    message: true
  config:
    - name: '@cordisjs/plugin-include'
      config:
        path: ./instances/bob.yml

# Shared infrastructure (outside Life scopes)
- name: '@cordisjs/plugin-database-sqlite'
- name: '@cordisjs/plugin-hmr'
- name: '@cordisjs/plugin-webui'
```

**How isolation works**:
- `isolate: { life: true, message: true }` creates private symbols for `life` and `message` services within each group
- Alice's `ctx.life` and Bob's `ctx.life` are independent instances (different symbols)
- Alice's Cortex cannot access Bob's message service (different symbol for `message`)
- Cordis events still propagate (for observability), but service access is scoped

### 12.5 Instance File is Self-Contained

An instance file is a **complete, portable Life definition**. It can be:
- Shared between deployments (copy `instances/alice.yml` to another machine)
- Version-controlled independently
- Hot-reloaded via HMR (if `instances/` is in HMR watch list)
- Managed by WebUI (via plugin-include → entries visible in plugin tree)

### 12.6 No Custom Instance Loader

The Instance mechanism uses ONLY standard cordis primitives:
- `plugin-include` for file referencing
- `plugin-group` for scoping (v2)
- `isolate` config for service isolation (v2)

No custom `@athena-ai/instance-loader` is needed. This is a deliberate design choice — staying within cordis's standard mechanisms ensures WebUI compatibility, HMR support, and no maintenance burden.

---

## Part XIII: Updated Decision Summary

| # | Decision | Rationale |
|---|---|---|
| M-15 | `@athena-ai/core` is types + base classes only; no runtime service | Keeps core minimal; runtime work belongs in plugin-life |
| M-16 | `@athena-ai/plugin-life` provides `ctx.life` (persona, memory, one-Cortex enforcement) | Concrete runtime per Life scope; installable multiple times for multi-Life |
| M-17 | capability-message has NO dependency on core | Capabilities are pure cordis Services; connection happens at Cortex level via dual inject |
| M-18 | One-Cortex-per-Life enforced by registerCortex() in Cortex base class | Runtime guard; second Cortex throws immediately |
| M-19 | Instance = standard YAML file loaded via `plugin-include` | No custom loader; full cordis ecosystem compatibility (WebUI, HMR) |
| M-20 | Multi-Life isolation uses cordis loader `isolate` config on `plugin-group` | Native mechanism; each Life scope gets private symbols for `life` and `message` |
