# Runtime User Interface Map

**Status:** designing

## Notes

- The previous implementation slice was rolled back.
- Mode Pipeline code remains as the only kept implementation artifact.
- This map now tracks the design-only process.

## Decisions So Far

- Life is the persistent identity; channel is a Mode-owned conversation scope.
- Mode owns full product orchestration.
- Body owns only real external connections.
- Mode Pipeline is Trigger -> Context -> Execute -> Interpret -> Effects -> Continue.
- Modes and Bodies are specialized plugin packages.
- RuntimeController is the single mutation path for package lifecycle and Life reconciliation.
- Package config is defined with Schemastery.
- `add` is generic: read manifest, detect kind, install plugin.
- API and web console are deferred until runtime contracts stabilize.

## Fog

- Package installation source is unresolved.
- Real Mode migration order is unresolved.
- Life data migration from YesImBot v4 is unresolved.
- Package upgrade and secret storage policies are unresolved.

## Frontier

- No implementation tickets exist yet.
- Next step is design review and ADR freeze before implementation.
