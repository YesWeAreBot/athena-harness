# Design: Multi-Life 加载与隔离机制

**Created**: 2026-08-20

**Status**: Approved

**Input**: Root cause analysis of `bots accessor` / `cortex registered` / `Only one Cortex per Life` errors in multi-group deployment; deep analysis of cordis v4-rc.8 isolation primitives (`reflect.ts`, `fiber.ts`, `context.ts`, `events.ts`, loader `isolate.ts`).

---

## §1. Root Cause Analysis

### Error 1: `property "bots" is already declared as accessor`

**Cause chain**:

1. `app.yml` defines two groups (Alice, Bob), each with `isolate: { satori: true, bots: true }`
2. Each group contains `@athena-ai/capability-message`
3. `MessageService` constructor calls `ctx.plugin(Satori)`
4. `Satori` constructor calls `ctx.mixin('satori', ['bots', 'component'])` — `vendor/satorijs/core/src/index.ts:135`
5. `mixin` internally calls `accessor('bots', {get, set})` for each key — `reflect.ts:248`
6. `accessor` checks `if (name in this.props)` — `reflect.ts:231`
7. `this.props` is a **SINGLETON dict** on root `ReflectService` — `reflect.ts:136`
8. First Satori succeeds: `props['bots'] = {type:'accessor', ...}`
9. Second Satori finds `props['bots']` already exists → **throws**

**Root cause**: `accessor`/`mixin` registers property descriptors in a global namespace (`props` dict, string-keyed). `isolate` only isolates service instances (`store` dict, Symbol-keyed). Therefore `isolate: { bots: true }` has **zero effect** on accessor conflicts. Any Service that calls `ctx.mixin()` can only have one live fiber in the entire process.

**Evidence**:
- `references/cordis/packages/core/src/reflect.ts:229-236` — accessor conflict detection
- `references/cordis/packages/core/src/reflect.ts:239-264` — mixin calls accessor
- `vendor/satorijs/core/src/index.ts:135` — Satori calls mixin
- `references/cordis/packages/core/src/reflect.ts:136` — props is singleton

---

### Error 2: `service "cortex" has been registered at <CortexChat>` (Config A)

**Cause chain**:

1. Config A does not set `isolate: { cortex: true }`
2. Both groups' `ctx[Context.isolate]['cortex']` point to the same root symbol
3. First CortexChat's `super(ctx, 'cortex')` → `provide('cortex', self)` → `store[rootSymbol] = impl` ✅
4. Second CortexChat's `provide('cortex', self)` → `store[rootSymbol]` exists → **throws** (`reflect.ts:187-188`)

**Root cause**: Un-isolated service cannot be `provide`d twice.

---

### Error 3: `Only one Cortex per Life` (Config B)

**Cause chain**:

1. Config B adds `isolate: { cortex: true }` → each group gets different cortex symbol → `provide` no longer conflicts ✅
2. But Life is installed in **prelude** (`cordis.yml`) → only one global Life instance
3. Both CortexChat instances `inject ['life']` → obtain same Life instance
4. First CortexChat: `life.registerCortex(this)` → `this._cortex = cortexA` ✅
5. Second CortexChat: `life.registerCortex(this)` → `this._cortex` already set → **throws**

**Root cause**: Life is installed at root ctx (prelude) without per-group isolate. Even with cortex isolated, both Cortex instances share the same Life, and `registerCortex()` is a per-instance singleton check.

**Evidence**:
- `cordis-boilerplate/cordis.yml` — Life configured in prelude with persona config
- `packages/core/src/life.ts:36-38` — registerCortex check

---

### Duplicate Cordis Realm (secondary issue)

- `athena-harness/node_modules/cordis` and `cordis-boilerplate/node_modules/cordis` are two physical copies
- Same content (md5 matches) but different ESM module identity (`Context === Context` is `false`)
- Cause: `@athena-ai/*` packages are symlinked to `athena-harness/packages/*`; ESM resolves from physical path
- Impact: Not the direct cause of the reported errors, but may cause subtle Symbol mismatches
- Remediation: Add `resolutions` in boilerplate `package.json` to force single resolution

---

## §2. Constraint Inventory: cordis v4 Isolation Capabilities

### ✅ What works

| # | Capability | Mechanism |
|---|---|---|
| 1 | Service instance isolation | Different isolate symbol → different store slot → multi-instance coexistence |
| 2 | Service resolve scoping | `ctx[isolate][name]` → symbol → `store[symbol].value` |
| 3 | Event scope filtering | `session[Context.filter]` limits which hooks receive events |
| 4 | Mixin accessor indirect isolation | Register accessor once; getter resolves `ctx[source]` per caller's isolate symbol |
| 5 | Loader isolate config | Takes effect before fiber init; child entries inherit isolate symbols |

### ❌ What doesn't work

| # | Limitation | Reason |
|---|---|---|
| 1 | accessor/mixin cannot be registered twice | Global `props` namespace conflict |
| 2 | isolate cannot prevent mixin collision from same constructor | isolate doesn't affect props |
| 3 | Service constructor global side effects | Not scoped by isolate (e.g., `ctx.on('http/fetch')`) |
| 4 | Event hooks are globally shared | `_hooks` dict on EventsService; only runtime `[Context.filter]` can scope |

### ⚠️ Critical constraint

**Any Service that calls `ctx.mixin()` in its constructor can only have ONE live fiber in the entire cordis process.** The accessor's effect-dispose (`delete this.props[name]`) only runs when the fiber is disposed. While two fibers coexist, the second registration always throws.

This means **Satori can only exist as a single instance per process** — even if `satori` is isolated, the mixin call can only execute once.

---

## §3. Approved Design: Scheme B' (Implemented)

### Summary

Vendored Satori's `ctx.mixin()` call is removed. Life is extracted into `@athena-ai/plugin-life` and installed per-group. A new `@athena-ai/protocol` package holds the abstract `Cortex` class and type interfaces. `@athena-ai/core` remains as a prelude shell for future pre-processing. Group isolate config includes `satori: true` so that adapters (siblings in the group) share each MessageService's Satori instance without cross-group conflicts.

### 3.1 Package Architecture (Final)

```
@athena-ai/protocol     — Types (Persona, LifeService, MemoryProvider) + Cortex abstract class + module augmentation
@athena-ai/plugin-life  — Life service implementation (provides 'life')
@athena-ai/core         — Prelude plugin shell (future: pre-processing hooks)
@athena-ai/cortex-chat  — Cortex implementation (provides 'cortex')
@athena-ai/capability-message — MessageService (provides 'message', installs Satori)
```

Dependency direction:
```
protocol (types + Cortex base)
    ↑              ↑
plugin-life    cortex-chat
                   ↑
              capability-message (peer)
```

### 3.2 Changes Made

| Target | Change | Rationale |
|--------|--------|-----------|
| `vendor/satorijs/core/src/index.ts:135` | Deleted `ctx.mixin('satori', ['bots', 'component'])` | Eliminates accessor conflict; Athena doesn't need `ctx.bots` / `ctx.component` shortcuts |
| `vendor/satorijs/core/src/bot.ts` | Changed `ctx.bots` → `ctx.satori.bots` (3 locations) | Adapts to mixin removal |
| `vendor/satorijs/adapter-qq/src/bot/index.ts` | Changed `ctx.bots` → `ctx.satori.bots` | Adapts to mixin removal |
| `packages/protocol/` (NEW) | Types, Cortex abstract class, `declare module 'cordis' { ctx.life }` | Protocol layer separating interface from implementation |
| `packages/plugin-life/` (NEW) | Life class with `bind(cortex)` → disposer pattern | Per-group Life service |
| `packages/core/` | Reduced to empty prelude shell (`export function apply()`) | Future pre-processing; no longer holds types/services |
| `packages/cortex-chat/` | Import Cortex from `@athena-ai/protocol` instead of `@athena-ai/core` | Follows new package structure |
| `packages/sandbox/src/index.ts` | Changed `ctx.bots` → `ctx.satori.bots` | Adapts to mixin removal |
| `cordis.yml` prelude | Removed persona config from `@athena-ai/core` | Core is now config-free shell |
| `app.yml` groups | `isolate: { life, cortex, message, satori }` + `@athena-ai/plugin-life` with persona config | Per-group Life + Satori isolation |

### 3.3 Life ↔ Cortex Binding

- `Life.bind(cortex: Service): () => void` — binds a Cortex to this Life, returns a disposer
- One Life can have at most one bound Cortex; second `bind()` throws
- Disposer uses name comparison (not identity) due to cordis proxy wrapping
- `Cortex.*[Service.init]()` calls `this.ctx.life.bind(this)` and yields the returned disposer
- On fiber dispose, cordis automatically invokes the yielded disposer → Life unbinds
- No explicit `unbind()` method exposed

### 3.4 Life Carrier Form

- **Container**: `@cordisjs/plugin-group` with `isolate: { life: true, cortex: true, message: true, satori: true }`
- **Service**: `@athena-ai/plugin-life` provides `'life'`, one fiber per group
- **Lifecycle**:
  - Start: group → Life activates → Cortex injects life → `bind()` → Cortex active
  - Dispose: group disposed → Cortex fiber dispose → yielded disposer fires → `_cortex = null` → Life fiber dispose
- **Resource reclamation**: cordis fiber dispose automatically runs all collected disposables

### 3.5 satori/bots Exposure Path

```
Life Group Context (isolate: { life, cortex, message, satori })
├── ctx.life = Life (plugin-life)              ← visible within group
├── ctx.message = MessageService               ← visible within group
│   └── ctx.satori = Satori                    ← visible within group (shared with adapters)
│       └── this.bots = [Bot, ...]             ← accessed via ctx.message.bots or ctx.satori.bots
├── ctx.cortex = CortexChat                    ← visible within group
│   └── accesses ctx.message.bots, ctx.life.persona
├── Adapter plugins (onebot, etc.)             ← inject: ['satori'], register bots
│
│   ❌ ctx.bots → undefined (no mixin accessor registered anywhere)
│   ✅ ctx.satori.bots → works (service access, not mixin)
└──
```

### 3.6 Event Isolation

Unchanged from current implementation:

1. MessageService hooks `internal/session` to inject `session[Context.filter]`
2. Filter compares: `hookCtx[Context.isolate]['message'] === messageSymbol`
3. Each group has `isolate: { message: true }` → different symbols per group
4. Result: Alice's adapter events only reach Alice's listeners; Bob's only reach Bob's

### 3.7 Why `satori: true` Is Still Needed in Group Isolate

With mixin removed, `isolate: { satori: true }` no longer causes accessor conflicts. It IS needed because:
- MessageService calls `ctx.plugin(Satori)` which does `provide('satori', ...)`
- Without `satori: true`, both groups share the root satori symbol → second `provide` conflicts
- With `satori: true`, each group gets its own satori symbol → multiple Satori instances coexist
- Adapters as sibling entries in the group share the same satori symbol → they `inject: ['satori']` and access `ctx.satori.bots`

### 3.8 Target app.yml (Validated)

```yaml
# === Alice ===
- name: '@cordisjs/plugin-group'
  label: Alice
  isolate:
    life: true
    cortex: true
    message: true
    satori: true
  config:
    - name: '@athena-ai/plugin-life'
      config:
        persona:
          name: Alice
          description: A curious and friendly digital life.
          traits: { personality: curious, friendly, helpful }
    - name: '@athena-ai/capability-message'
    - name: '@athena-ai/cortex-chat'
    - name: '@athena-ai/adapter-onebot'
      config: { selfId: '123', endpoint: ws://..., protocol: ws }
    - name: '@athena-ai/plugin-sandbox'

# === Bob ===
- name: '@cordisjs/plugin-group'
  label: Bob
  isolate:
    life: true
    cortex: true
    message: true
    satori: true
  config:
    - name: '@athena-ai/plugin-life'
      config:
        persona:
          name: Bob
          description: A thoughtful digital philosopher.
          traits: { personality: contemplative }
    - name: '@athena-ai/capability-message'
    - name: '@athena-ai/cortex-chat'
    - name: '@athena-ai/adapter-onebot'
      config: { selfId: '456', endpoint: ws://..., protocol: ws }
```

### 3.9 Target cordis.yml (prelude)

```yaml
- name: '@cordisjs/plugin-cli'
  config:
    name: athena
- name: '@cordisjs/plugin-cli-cordis'
  config:
    path: ./app.yml
    daemon:
      enabled: true
    prelude:
      - name: '@cordisjs/plugin-env'
      - name: '@cordisjs/plugin-logger-console'
      - name: '@athena-ai/core'  # empty shell, no config
```

---

## §4. Adapter Compatibility

With `ctx.mixin('satori', ['bots', 'component'])` removed, `ctx.bots` no longer exists anywhere. All internal Satori code was updated to use `ctx.satori.bots` directly.

Affected locations (all fixed in vendored code):
- `vendor/satorijs/core/src/bot.ts` — constructor, dispose, status setter
- `vendor/satorijs/adapter-qq/src/bot/index.ts` — stop method
- `packages/sandbox/src/index.ts` — ensureBot

---

## §5. Impact on Existing Specs

| Spec Decision | Impact |
|---|---|
| M-01 (satori hidden inside message) | ⚠️ Revised: satori visible within group (adapters need it), hidden from outside group |
| M-02 (session filter event isolation) | ✅ No change |
| M-15 (core = types only) | ✅ Superseded: types moved to `@athena-ai/protocol`; core is prelude shell |
| M-16 (plugin-life provides ctx.life) | ✅ Implemented |
| M-20 (multi-life via group isolate) | ✅ Revised: `{ life, cortex, message, satori }` |

### Decisions recorded

| # | Decision | Rationale |
|---|---|---|
| M-21 | Vendored Satori removes `ctx.mixin('satori', ['bots', 'component'])` | Eliminates multi-instance accessor conflict |
| M-22 | New `@athena-ai/protocol` package for types + Cortex abstract class | Clean separation of interface from implementation |
| M-23 | `@athena-ai/core` becomes prelude shell (no types, no services) | Future pre-processing hooks; lightweight |
| M-24 | app.yml isolate config is `{ life, cortex, message, satori }` | satori needed for adapter sibling access; mixin removal makes it safe |
| M-25 | `Life.bind(cortex)` returns disposer; no explicit `unbind()` | Leverages cordis lifecycle; name comparison for proxy compatibility |
| M-26 | All `ctx.bots` references replaced with `ctx.satori.bots` | Consistent with mixin removal |

---

## §6. Clarification: How Isolate Actually Works

For future reference, the precise semantics of cordis v4 isolation:

- **`ctx.isolate(name)`** creates a new `[Context.isolate]` shadow with a fresh symbol for `name`
- **`provide(name, value)`** registers in `store[ctx[isolate][name]]` — keyed by the SYMBOL
- **`accessor(name, opts)`** registers in `props[name]` — keyed by the STRING, globally unique
- **`mixin(source, keys)`** calls `accessor` for each key — same global constraint

**Isolate only affects service lookup (store), NOT property descriptor registration (props).**

This is a design choice in cordis v4, not a bug. Mixin/accessor are designed to be registered once globally, providing a uniform property interface. The service they delegate to is isolate-aware, so the mixin getter naturally returns different values in different isolation domains — but the getter itself can only be registered once.

### Cordis proxy identity caveat

Cordis wraps service instances in Proxy for context rebinding. This means `serviceA === serviceB` can be `false` even when they represent the same underlying object. Code that stores service references must compare by `.name` (or other stable identifier), not by identity. This affects `Life.bind()` disposer logic.
