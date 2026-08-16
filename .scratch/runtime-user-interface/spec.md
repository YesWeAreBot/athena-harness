# Athena Runtime Application Layer Design

**Status:** Proposed, with first vertical slice implemented
**Date:** 2026-08-16
**Scope:** User-facing runtime layer above `@yesimbot/athena-runtime` and the canonical `@athena/*` core.

## 1. Problem

The repository currently contains framework packages but no user-facing application layer:

- Plugins are assembled in code with `ctx.plugin(...)`.
- Bodies are instantiated in code, e.g. `onebotBody({ wsUrl, httpUrl, ... })`.
- Modes are registered in code and cannot be installed, configured, or managed by users.
- There is no runtime bootstrap, no CLI, no management API, and no web console.

Real Modes cannot be migrated into the runtime until there is a package boundary, a declarative config model, and a management surface.

## 2. Goals

- Provide a declarative `athena.yaml` config for starting a complete Athena runtime.
- Define installable Mode and Body packages with manifests and config schemas.
- Provide a CLI for local operation and scripts.
- Provide a management API as the single control plane.
- Provide a web console for non-technical users.
- Support Life, Mode, Body, model, memory, state, delivery, media, session, and log management.
- Keep canonical `@athena/*` and `@yesimbot/athena-runtime` library boundaries intact.

## 3. Non-Goals

- This design does not implement product Modes such as Chat, World, or Interlude.
- This design does not build a multi-tenant hosted platform.
- This design does not replace the existing runtime internals.
- Mobile apps are out of scope for the first pass.

## 4. Architecture

```text
athena.yaml
    |
    v
athena-bootstrap (CLI entry)
    |
    +-> Cordis Context
    +-> canonical core plugins
    +-> athena-runtime plugins
    +-> Mode/Body package loader
    +-> Life reconciliation
    +-> Management API
    +-> Web console
```

Layered package layout:

```text
apps/
  athena-cli/       @yesimbot/athena-cli
  athena-console/   @yesimbot/athena-console
packages/
  runtime-config/   @yesimbot/athena-config
  runtime-manager/  @yesimbot/athena-runtime-manager
  runtime-api/      @yesimbot/athena-runtime-api
  athena-runtime/   existing digital-life runtime
  onebot-body/      existing Body adapter
```

The root workspace must add `"apps/*"` to `workspaces`.

## 5. Config Model

There are two kinds of state:

1. `athena.yaml`: declarative desired state owned by the user.
2. `{dataDir}/runtime.json`: runtime-derived state, including created Life instances and status snapshots.

### 5.1 Example Config

```yaml
runtime:
  name: my-athena
  dataDir: ./data

core:
  persistence: jsonl
  agentLoop: default

modelProviders:
  - id: openai
    provider: "@yesimbot/provider-openai"
    roles: [main]
    config:
      model: gpt-4.1

modes:
  - id: chat
    package: "@yesimbot/mode-chat"
    version: 0.1.0
    enabled: true
    config:
      systemPrompt: "You are a helpful companion."

bodies:
  - id: onebot
    package: "@yesimbot/body-onebot"
    version: 0.1.0
    enabled: true
    config:
      wsUrl: ws://127.0.0.1:6700
      httpUrl: http://127.0.0.1:3000
      selfId: "123456"

lives:
  - id: athena-1
    mode: chat
    modelProvider: openai
    bodies: [onebot]

api:
  enabled: true
  host: 127.0.0.1
  port: 7788
  token: ${ATHENA_TOKEN}

console:
  enabled: true
```

### 5.2 Config Shape

```ts
interface RuntimeConfig {
  runtime: {
    name: string;
    dataDir: string;
  };
  core: {
    persistence: "none" | "jsonl";
    agentLoop: "default";
  };
  plugins?: Array<{
    id: string;
    package: string;
    enabled?: boolean;
    config?: unknown;
  }>;
  modelProviders?: ModelProviderConfig[];
  modes?: ModeConfig[];
  bodies?: BodyConfig[];
  lives?: LifeConfig[];
  api?: ApiConfig;
  console?: { enabled: boolean };
}
```

All config objects are validated with zod. Secrets support `${ENV_VAR}` substitution.

## 6. Mode Package Contract

A real Mode becomes an installable package.

### 6.1 Manifest

```json
{
  "name": "@yesimbot/mode-chat",
  "version": "0.1.0",
  "runtime": ">=0.1.0",
  "entry": "./dist/index.js",
  "configSchema": "./dist/config.schema.json",
  "capabilities": {
    "driver": "finite-tool-loop",
    "percepts": [{ "body": "onebot", "kind": "message-created" }],
    "actuators": [{ "body": "onebot", "kind": "chat" }],
    "scheduling": ["event"],
    "memory": ["conversation", "facts"],
    "productState": ["channel"]
  }
}
```

The manifest lives in `athena.mode.json` or is referenced from `package.json` as `"athena": { "mode": "./athena.mode.json" }`.

### 6.2 Entry Contract

```ts
import type { Mode } from "@yesimbot/athena-runtime";

const mode: Mode = {
  name: "chat",
  setup(ctx, config) {
    // config is validated by the loader against configSchema
  },
};

export default mode;
```

The loader maps the manifest `capabilities` onto the existing `ModeCapabilities` type.

## 7. Body Package Contract

A Body adapter becomes an installable package.

### 7.1 Manifest

```json
{
  "name": "@yesimbot/body-onebot",
  "version": "0.1.0",
  "runtime": ">=0.1.0",
  "entry": "./dist/index.js",
  "configSchema": "./dist/config.schema.json"
}
```

### 7.2 Entry Contract

```ts
import type { BodyAdapter } from "@yesimbot/athena-runtime";

export function createBodyAdapter(config: unknown): BodyAdapter {
  return {
    id: config.id,
    start: async (ctx) => { /* ... */ },
    stop: async () => { /* ... */ },
  };
}
```

The loader validates `config`, creates one Body instance per `bodies[]` entry, and registers it with `ctx.bodies`.

## 8. Bootstrap Sequence

1. Load `athena.yaml`.
2. Validate config and resolve environment variables.
3. Create the Cordis `Context`.
4. Install canonical core plugins.
5. Install athena-runtime plugins.
6. Load and register Body packages.
7. Load and register Mode packages.
8. Reconcile Life instances from `lives[]`.
9. Start the management API and optional web console.

## 9. Life Reconciliation

The runtime compares `lives[]` with `runtime.json`:

- Missing Life -> create.
- Mode, model provider, or attached bodies changed -> update.
- Life removed from config -> dispose by default.
- Session files are not deleted unless the user explicitly deletes the Life through the API or CLI.

The reconciliation must be idempotent and safe to rerun on startup.

## 10. Management API

The API is the single control plane. The web console and CLI are clients of the same API.

### 10.1 Core Endpoints

```text
GET    /api/lives
POST   /api/lives
GET    /api/lives/:id
DELETE /api/lives/:id
POST   /api/lives/:id/wake
PUT    /api/lives/:id/mode
PUT    /api/lives/:id/model
PUT    /api/lives/:id/bodies

GET    /api/bodies
POST   /api/bodies
GET    /api/bodies/:id
DELETE /api/bodies/:id
GET    /api/bodies/:id/state
POST   /api/bodies/:id/act

GET    /api/modes
POST   /api/modes
POST   /api/modes/:id/enable
POST   /api/modes/:id/disable

GET    /api/model-providers
POST   /api/model-providers

GET    /api/sessions/:id/events
GET    /api/memory/:lifeId
POST   /api/memory/:lifeId
GET    /api/state/:lifeId/:providerId
PUT    /api/state/:lifeId/:providerId
GET    /api/media
POST   /api/media
GET    /api/deliveries
POST   /api/deliveries/cancel

GET    /api/events
GET    /api/settings
PUT    /api/settings
```

`GET /api/events` uses SSE for live status and log updates.

### 10.2 Security

- Default bind is `127.0.0.1`.
- API token is optional but recommended.
- Secrets are never returned by list endpoints.
- Mutating requests require the token when configured.

## 11. Web Console

The console is a real user-facing app, not documentation or a landing page.

Primary views:

- Dashboard: Lives, Body status, active Mode, recent events.
- Life detail: session events, active Mode, bodies, model, memory, state, deliveries.
- Mode manager: install, enable/disable, configure, and switch Modes.
- Body manager: create/edit/remove Body instances, view state, test actuators.
- Model providers: configure providers and assign roles.
- Data: memory records, state, media, delivery queue.
- Logs: runtime, Life, Mode, Body, and percept events.

The console calls the management API only. It does not import runtime internals directly.

## 12. CLI

```text
athena init
athena validate
athena start
athena config show

athena life list
athena life create
athena life remove
athena life mode
athena life body

athena mode list
athena mode install
athena mode enable
athena mode disable

athena body list
athena body add
athena body remove
athena body status

athena log follow
```

## 13. Migration Path

### 13.1 Mode Migration

1. Add a manifest and config schema.
2. Wrap the existing `setup/handle/providers` in a package entry.
3. Add a contract test that installs and runs the Mode through the loader.
4. Add a migration test from prototype Mode shape to package shape.
5. Move real Modes one at a time.

### 13.2 Body Migration

1. Move `onebotBody(config)` into a package manifest entry.
2. Add config schema validation.
3. Keep `ctx.bodies.registerAdapter()` as the low-level API.
4. Let the loader create Body instances from config.

### 13.3 Plugin Migration

1. Keep code-level plugin API for developers.
2. Add config-driven plugin declarations for runtime users.
3. The bootstrap layer maps config entries to `ctx.plugin(...)`.

## 14. Design Decisions

- **D1:** `athena.yaml` is desired state; `runtime.json` is derived state.
- **D2:** Mode and Body packages must declare a manifest and config schema.
- **D3:** The management API is the single control plane.
- **D4:** The runtime is local-first by default.
- **D5:** New application packages use the `@yesimbot` scope and live under `apps/`.

## 15. Open Questions

- Package installation: filesystem paths, Yarn workspaces, or a registry.
- Web console stack.
- Secret storage beyond env substitution.
- Mode upgrade/downgrade policy.
- Multi-user and multi-instance requirements.

## 16. Suggested Milestones

1. Config schema + bootstrap + CLI.
2. Mode/Body manifest loader.
3. Management API.
4. Web console.
5. Migrate one real Mode and one real Body.

## 17. First Vertical Slice

Implemented in this pass:

- `packages/athena-config`: zod schema, YAML/JSON loading, env substitution.
- `packages/athena-loader`: local Mode/Body manifest discovery, runtime version check, JSON Schema config validation, dynamic entry loading.
- `packages/athena-runtime-manager`: Cordis bootstrap, builtin pipeline/body registration, Life reconciliation.
- `packages/athena-runtime-api`: management endpoints and static console serving.
- `packages/athena-console`: lightweight browser dashboard.
- `packages/athena-cli`: `init`, `validate`, `start`, and `life:list`.
- `athena-runtime/src/mode-pipeline`: Trigger -> Context -> Execute -> Interpret -> Effects -> Continuation runner.

Still missing:

- Package registry/installer flow (filesystem packages work; npm/workspace registry installation is not implemented).
- Real product Mode migration.
- Full Life/Body/model/delivery management API.
- Console authentication and editing of configured resources.
