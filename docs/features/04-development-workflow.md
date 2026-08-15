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
packages/
  harness-core/
    src/
      agent/           AgentRegistry and Agent contracts
      agent-loop/      real AI SDK Agent Loop provider
      session/         Session, SessionStore, Surface, Event vocabulary
      persist/         Persistence and JsonlPersistence
      model-surface.ts ModelSurface and user projectors
      tools.ts         ToolRuntime
      system-prompt.ts SystemPrompt
      index.ts         public exports
    test/
  athena-runtime/
    src/
      body/            BodyRegistry, PerceptEvent, Sense/Actuator contracts
      index.ts         public exports
    test/
```

## Contribution Loop

1. Read `docs/design.md` before adding a feature.
2. Keep changes inside the correct package; add a new `packages/*` workspace only when a real package boundary is proven.
3. Add tests for the failure boundary, not just the happy path.
4. Run the full verification chain before submitting.
5. Update `docs/features/*` when a feature becomes usable by developers.
