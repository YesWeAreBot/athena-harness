# Repository Guidelines

AI agent working guide for **athena-harness** — the runtime kernel for digital beings (Life / Cortex / Nerve primitives). Not a Koishi fork: it shares Cordis as the composition base but builds its own IM protocol layer (Nerve).

**Read this, then open the relevant `docs/` entry before writing code.** Docs are the deep reference and are authoritative over `.specify/specs/` (design history, often superseded).

## Authority

```
current code  >  user's latest instruction  >  docs/  >  .specify/specs/
```

When unsure about Cordis behavior, read `node_modules/cordis` source — do not assume from specs.

## Tech Stack

| Layer           | Choice                                                             |
| --------------- | ------------------------------------------------------------------ |
| Composition     | Cordis v4 (`^4.0.0-rc.8`) — DI, fiber lifecycle, events, isolate   |
| IM protocol     | Self-built Nerve: `@athena-ai/protocol` + `@athena-ai/protocol-im` |
| LLM             | AI SDK v7 (`ai@^7`), providers registered via `provider-*` plugins |
| Config          | schemastery (`Schema`)                                             |
| Build           | yakumo (tsc declarations → esbuild JS → client)                    |
| Quality         | oxlint (+ anti-slop rules) + oxfmt                                 |
| Tests           | Vitest                                                             |
| Package manager | Yarn 4 workspaces (Node ≥ 22; CI uses Node 24)                     |

## Architecture — one screen

Full detail: `docs/02-architecture.md`.

- **Layers:** Cordis → `@athena-ai/core` (prelude shell, installs `NerveService`) → managed plugins (`app.yml`: life, cortex, nerves, providers).
- **`packages/` = libraries** (types, base classes: `core`, `protocol`, `protocol-im`, `ai`); **`plugins/` = runtime units** providing Services.
- **Event flow:** adapter → `body.session({...nested data})` → `body.dispatch(session)` → `internal/session` normalizer → re-emit from source Body's ctx (`message-created`, ...) → Cortex `ctx.on(...)`. Event signatures live **only** in `cordis.Events` (no parallel maps). Details: `docs/02-architecture.md` §5, §7.
- **Isolation:** each Life is a group with `isolate: { life, cortex, nerve: true }`; global services (`sandbox` Hub, `ai`) stay at root. Details: `docs/02-architecture.md` §4.
- **Bodies:** adapters extend `IMBody`, register via `BodyRegistry` module augmentation, addressable as `ctx.nerve.get("platform:selfId")`; unimplemented capabilities are absent (use `supports()`), never placeholders. Details: `docs/02-architecture.md` §6, §7.
- **Hub + Nerve split:** a plugin owning both global and per-Life resources splits into a root Hub + per-Life Nerve (`plugins/sandbox` + `plugins/sandbox-nerve` as reference).

## Development Commands

```bash
yarn install          # Yarn 4 workspaces
yarn build            # yakumo: tsc → esbuild → client
yarn lint / lint:fix  # oxlint (anti-slop rules)
yarn format / format:check  # oxfmt — never hand-format
yarn test             # ← run ALL tests
```

## Testing & QA

- **Vitest**; specs in each package's `tests/`, named `<subject>.spec.ts`; run with `yarn test`.
- **Never mock Cordis** — real `new Context()` + real plugins; only fake the external world (HTTP, WebSocket, browser).
- **Unmet-inject tests:** do not `await` the plugin (fiber stays PENDING and hangs); assert `ctx.get(...)` is `undefined`.
- New Service coverage bar (visible after install, inactive per unmet inject, releases on dispose, throws on contract violations) and more: `docs/03-code-conventions.md` §8.
- CI: lint → test → build on Node 24.

## Documentation Map

| Task                                              | Read first                                                          |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| Understand the project                            | `docs/00-overview.md`                                               |
| Architecture, isolation, event flow               | `docs/02-architecture.md`                                           |
| **Write any code (mandatory)**                    | `docs/03-code-conventions.md`                                       |
| New Service / Cortex / Nerve / Adapter / AI usage | `docs/04-patterns-and-recipes.md`                                   |
| Avoid known traps (before changes)                | `docs/05-lessons-learned.md` (§13 quick table, §14 Nerve migration) |
| Progress, known defects, roadmap                  | `docs/06-progress-and-roadmap.md`                                   |
| Tool design (context, scope, registration)        | `docs/cookbook/04-tool-design.md`                                   |

**Doc sync duty** (when adding packages / Services / IM events / pitfalls / decisions): `docs/03-code-conventions.md` §11.3.
