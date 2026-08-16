# Runtime User Interface Map

**Status:** designing + first vertical slice implemented

## Notes

- The repository is library-only today: no runtime bootstrap, no config file, no CLI, no management API, no web console.
- Plugins, Modes, and Bodies are currently code-level assemblies.
- The proposed layer sits above `@yesimbot/athena-runtime` and the canonical `@athena/*` core.

## Decisions So Far

- Config-first bootstrap is the entry point.
- Mode and Body packages declare manifests and config schemas.
- Management API is the single control plane.
- CLI and web console are clients of that API.
- Local-first security model is the default.
- A first implementation now exists under `packages/athena-*` and the new mode-pipeline module.
- `@yesimbot/athena-loader` now loads local Mode/Body packages from manifests and validates config schemas.

## Fog

- Package installation flow is unresolved.
- Web console stack is unresolved.
- Secret storage beyond env substitution is unresolved.
- Real Mode migration order is not chosen.

## Frontier

- No implementation tickets exist yet; the first slice was implemented directly from the spec.
- Next step is to split the remaining work into implementation tickets under `issues/`.
