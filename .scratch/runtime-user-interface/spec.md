# Athena Runtime Application Layer Design

**Status:** Design only
**Date:** 2026-08-16
**Scope:** The user-facing runtime layer above `@yesimbot/athena-runtime` and the canonical `@athena/*` core.

## 1. Problem

The current repository is framework-first. Users cannot install, configure, or run real products without writing code.

- Plugins and Modes are assembled in code.
- Bodies are instantiated in code with platform-specific config objects.
- Real Modes such as Chat, World, and Interlude cannot be migrated as installable packages.
- There is no stable runtime control surface.
- There is no clear boundary between what the Runtime owns and what a Mode owns.

The goal is not a demo CLI or a toy Mode. The goal is a runtime that can run real product Modes, manage real Bodies, and let users install and configure packages without writing code.

## 2. Goals

- Define what the Runtime owns and what Mode, Body, and plugin authors own.
- Define a generic plugin/package model for Modes, Bodies, and other runtime plugins.
- Define a declarative runtime config that users can edit and that can be reconciled by the runtime.
- Define a runtime controller that can install, remove, enable, disable, and reload packages.
- Define a Mode Pipeline that is not limited to the canonical AgentLoop.
- Use Schemastery for package config schemas so package authors do not hand-write JSON Schema.
- Provide a CLI as the first user-facing control surface.

## 3. Non-Goals

- No implementation is defined by this document.
- No web console is required before the runtime contracts are stable.
- No management API is required before the runtime contracts are stable.
- No product Mode implementation is included.
- No multi-tenant hosted platform is included.
- No mobile app is included.

## 4. Core Entities

### 4.1 Life

A Life is a persistent identity that exists across time and across execution modes.

Life owns:

- stable identity
- long-term Life-level memory and persona
- Session ownership
- Body attachments
- current Mode selection
- Life-level lifecycle and observability

Life does not own:

- execution logic
- platform connection details
- model configuration
- channel conversation state

A Life can participate in multiple conversations. A channel is not a Life. Channel isolation is a Mode-owned strategy.

### 4.2 Mode

A Mode is the complete orchestration strategy for how a Life operates.

Mode owns:

- trigger strategy
- context assembly
- execution driver
- result interpretation
- effect handling
- continuation and scheduling
- Mode-owned memory, state, and conversation scopes

A Mode is not a lightweight Koishi plugin. It is the full product logic. Chat, World, and Interlude are Modes.

### 4.3 Body

A Body is a real external connection between a Life and the outside world.

Body owns:

- platform connection
- platform event translation to Percept
- actuator execution
- Body state and connection lifecycle

Body does not own:

- Mode logic
- narrative interfaces
- virtual devices

Virtual interfaces such as the World Mode phone are Mode-internal abstractions over real Bodies.

### 4.4 Plugin

Plugin is the generic installable package concept. Mode and Body are specialized plugin kinds.

A plugin package must declare:

- identity
- version
- runtime compatibility
- entry
- config schema
- capabilities

The runtime treats Modes and Bodies as plugins with stronger contracts, not as separate bespoke systems.

## 5. Ownership Summary

| Entity  | Owns                                                               | Does not own                             |
| ------- | ------------------------------------------------------------------ | ---------------------------------------- |
| Life    | identity, Life memory, Session, Body attachment, Mode selection    | execution, platform, model               |
| Mode    | trigger, context, execution, interpretation, effects, continuation | Life identity, real platform connections |
| Body    | real connection, Percept, actuator, state                          | Mode narrative, model execution          |
| Runtime | package loading, config, Life reconciliation, plugin lifecycle     | product logic                            |

## 6. Mode Pipeline

The Mode contract is a fixed pipeline with six replaceable stages:

```text
Trigger
  -> Context Assembly
  -> Execution Driver
  -> Result Interpreter
  -> Effect Handler
  -> Continuation Plan
```

### 6.1 Trigger

Describes what starts an activation.

Examples:

- event response
- continuous run
- scheduled activation
- Life wake

### 6.2 Context Assembly

Builds the model-visible context.

Examples:

- conversation replay
- real-time state snapshot
- domain projection
- memory injection

### 6.3 Execution Driver

Defines how the model is called and how output is produced.

Examples:

- canonical AgentLoop
- single structured output
- custom driver

### 6.4 Result Interpreter

Converts raw model output into typed effects.

Examples:

- tool calls
- structured decisions
- plain text

### 6.5 Effect Handler

Applies effects to the world and to persistent state.

Examples:

- Session append
- Body actuator
- state mutation
- delivery
- media write

### 6.6 Continuation Plan

Describes what happens after effects are applied.

Examples:

- end
- continue immediately
- schedule next activation
- wake Life later

## 7. Package Model

### 7.1 Manifest

Every installable package has a manifest.

Mode package manifest:

```json
{
  "name": "@yesimbot/mode-world",
  "version": "0.1.0",
  "runtime": ">=0.0.0",
  "entry": "./dist/index.js",
  "configSchema": "./dist/config.js"
}
```

Body package manifest:

```json
{
  "name": "@yesimbot/body-onebot",
  "version": "0.1.0",
  "runtime": ">=0.0.0",
  "entry": "./dist/index.js",
  "configSchema": "./dist/config.js"
}
```

The package kind is detected from the manifest location or explicit metadata:

- `athena.mode.json`
- `athena.body.json`
- `athena.plugin.json`
- `package.json` under an `athena` field

### 7.2 Entry

A Mode entry exports a Mode or a Mode plus a Mode Pipeline.

```ts
import type { Mode, ModePipeline } from "@yesimbot/athena-runtime";

export const mode: Mode = {
  name: "world",
  setup: async () => {
    return {
      handle: async (event) => true,
    };
  },
};

export const pipeline: ModePipeline = {
  id: "world",
  trigger: { kinds: ["event", "scheduled"] },
  context: { id: "world-context", build: async () => ({ messages: [] }) },
  execution: { id: "world-exec", kind: "custom", execute: async () => ({ kind: "output", output: {} }) },
  interpret: { id: "world-interpret", interpret: async () => ({ effects: [] }) },
  effects: [],
};
```

A Body entry exports a factory that receives validated config and returns a BodyAdapter.

```ts
import type { BodyAdapter } from "@yesimbot/athena-runtime";

export function createBodyAdapter(config: unknown): BodyAdapter {
  return {
    id: config.id,
    name: config.name,
    state: {},
    start: async () => {},
    stop: async () => {},
  };
}
```

### 7.3 Config Schema

Package config is defined with Schemastery.

```ts
import Schema from "schemastery";

export const config = Schema.object({
  id: Schema.string(),
  wsUrl: Schema.string().required(),
  httpUrl: Schema.string().required(),
  accessToken: Schema.string().role("secret"),
});
```

The loader imports the module and calls the schema directly. Package authors do not hand-write JSON Schema.

## 8. Config Model

The runtime config is declarative desired state.

```yaml
runtime:
  name: my-athena
  dataDir: ./data

plugins:
  - id: onebot
    package: "@yesimbot/body-onebot"
    enabled: true
    config:
      wsUrl: ws://127.0.0.1:6700
      httpUrl: http://127.0.0.1:3000

  - id: world
    package: "@yesimbot/mode-world"
    enabled: true
    config: {}

lives:
  - id: athena-1
    mode: world
    bodies: [onebot]
```

The config contains:

- runtime identity and data directories
- installed plugins
- Life definitions
- plugin configs

Runtime-derived state such as created Life handles and status snapshots is stored separately from user config.

## 9. Runtime Controller

All user-facing operations go through a RuntimeController.

```text
CLI
 |
 RuntimeController
 |   |
 |   +-> package loader
 |   +-> Cordis registries
 |   +-> Life reconciliation
 |   +-> config persistence
 v
Runtime
```

RuntimeController operations:

- add package
- remove package
- enable package
- disable package
- reconfigure package
- switch Life Mode
- reload config
- reconcile Lives

`add` is generic. The user does not declare `mode` or `body`; the controller reads the manifest and detects the kind.

```text
athena add @yesimbot/body-onebot --config '{"wsUrl":"..."}'
athena add @yesimbot/mode-world --config '{}'
athena remove onebot
athena enable world
athena disable onebot
athena reload
```

## 10. Loader Behavior

The loader:

1. reads the package manifest
2. detects the package kind
3. checks runtime version compatibility
4. imports and applies the Schemastery config schema
5. imports the entry
6. returns a typed plugin handle

Loader errors are explicit and include package identity and config path.

## 11. Hot Reload

Hot reload is required for a real plugin system, but it must be designed carefully.

Requirements:

- ESM import cache must be busted for re-entry.
- Old Cordis effects must be disposed before new registration.
- Mode providers, memory, state, scheduler, and Body connections must be cleaned up.
- Config diff must be applied incrementally.
- Life reconciliation must be idempotent.

Recommended model:

```text
config change
  -> diff old/new
  -> unload removed or changed entries
  -> load new or changed entries
  -> reconcile Lives
  -> emit observability event
```

## 12. Life and Conversation Scope

YesImBot v4 currently treats each channel as a separate runtime. The new model should treat one Bot as one Life with multiple conversation scopes.

- Life is the persistent identity.
- Channel is a Mode-owned conversation scope.
- Mode decides whether a channel shares Life memory or isolates it.
- Products that genuinely need separate characters create separate Lives.

This preserves YesImBot v4 per-channel behavior while enabling cross-channel continuity.

## 13. Migration Path

### 13.1 Chat Mode

Wrap the YesImBot v4 ChannelRuntime as a Mode:

- preserve channel-scoped conversations
- expose existing Will and plugins as Mode capabilities
- use Life as identity instead of channel key

### 13.2 World Mode

Wrap YesImBotWorld as a Mode:

- keep the two-LLM architecture inside the Mode
- keep virtual phone and apps inside the Mode
- connect to real platforms through Bodies

### 13.3 Interlude Mode

Wrap Interlude as a Mode:

- use domain state and scheduling inside the Mode
- use structured output execution driver
- use Mode-owned continuation plans

### 13.4 Body Migration

Move real platform adapters into Body packages:

- manifest
- Schemastery config
- BodyAdapter entry

## 14. Design Decisions

- D1: Life is the persistent identity; channel is not Life.
- D2: Mode is the full product orchestration strategy.
- D3: Body is only a real external connection.
- D4: Mode Pipeline is the fixed execution contract.
- D5: Modes and Bodies are specialized plugin packages.
- D6: Config is declarative desired state.
- D7: RuntimeController is the single mutation path.
- D8: Package config is defined with Schemastery.
- D9: API and web console are deferred until these contracts stabilize.

## 15. Open Questions

- Package installation source: local paths, workspaces, or registry.
- Plugin market and package update semantics.
- Secret storage beyond environment substitution.
- Life migration from existing YesImBot channel data.
- Mode package version upgrade policy.
- Which real Mode is migrated first.

## 16. Milestones

1. Design review and ADR freeze.
2. Package manifest and Schemastery config contract.
3. RuntimeController add/remove/enable/disable/reload.
4. Config persistence and Life reconciliation.
5. Mode Pipeline integration with real Modes.
6. First real Mode migration.
7. First real Body migration.
8. CLI hardening and user documentation.
9. Optional API and web console after runtime contracts stabilize.
