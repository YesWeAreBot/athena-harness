# Runtime User Interface Map

**Status:** designing

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

## Fog

- Package installation flow is unresolved.
- Web console stack is unresolved.
- Secret storage beyond env substitution is unresolved.
- Real Mode migration order is not chosen.

## Frontier

- No implementation tickets exist yet.
- Next step after design review is to split the design into implementation tickets under `issues/`.
