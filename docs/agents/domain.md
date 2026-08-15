# Domain Docs

How engineering skills consume this repo’s domain documentation.

## Before exploring, read these

- `CONTEXT-MAP.md` at the repo root; it points to one `CONTEXT.md` per relevant context.
- `docs/adr/` for system-wide decisions.
- Each relevant context’s `docs/adr/` for scoped decisions.

If these files do not exist, proceed silently. `/domain-modeling` creates them only when terminology or decisions are resolved.

## File structure

```text
/
├── CONTEXT-MAP.md
├── docs/adr/                          ← system-wide decisions
└── packages/
    ├── harness-core/
    │   ├── CONTEXT.md
    │   └── docs/adr/                  ← context-specific decisions
    └── athena-runtime/
        ├── CONTEXT.md
        └── docs/adr/
```

## Use the glossary’s vocabulary

Use terms defined in the relevant `CONTEXT.md` for issue titles, proposals, hypotheses, and test names. If a needed concept is absent, reconsider the wording or note it for `/domain-modeling`.

## Flag ADR conflicts

Explicitly surface any conflict with an existing ADR rather than silently overriding it.
