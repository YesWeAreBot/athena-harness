# 04 - Development Workflow

## Commands

Use Corepack so Yarn 4 is selected from `package.json`:

```bash
corepack yarn install
corepack yarn typecheck
corepack yarn lint
corepack yarn test
corepack yarn build
corepack yarn format
```

The CI workflow runs `install`, `typecheck`, `lint`, `test`, and `build` on GitHub Actions.

## Module Layout

```text
src/
  agent/
    index.ts        AgentRegistry
    types.ts        Agent, AgentHandle, AgentFactory
  agent-loop/
    index.ts        placeholder Agent Loop provider
  session/
    events.ts       SessionEventMap and built-in vocabulary
    index.ts        Session, SessionStore
    surface.ts      SurfaceManager
    types.ts        shared session types
  model-surface.ts  ModelSurface and user projectors
  id.ts             id generation
  index.ts          public exports
test/
  core.test.ts
  surface.test.ts
  model-surface.test.ts
```

## Contribution Loop

1. Read `docs/design.md` before adding a feature.
2. Keep changes inside the current single package.
3. Add tests for the failure boundary, not just the happy path.
4. Run the full verification chain before submitting.
5. Update `docs/features/*` when a feature becomes usable by developers.
