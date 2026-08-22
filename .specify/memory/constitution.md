<!-- Sync Impact Report
Version change: 0.0.0 (unfilled template) → 1.0.0
Modified principles: N/A (initial population)
Added sections:
  - Core Principles (5 principles)
  - Architectural Constraints (hard rules)
  - Development Workflow
  - Governance
Removed sections: None
Follow-up TODOs: None
-->

# Athena Harness Constitution

## Core Principles

### I. Digital Life as Primary Identity

Athena exists to make digital beings **live**, not merely respond.
The framework's identity is "digital life runtime kernel" — NOT a bot
framework, NOT an LLM pipeline, NOT a generic agent executor.

- Every architectural decision MUST be evaluated against the question:
  "Does this let the entity *exist continuously*, or does it reduce it
  to a reactive responder?"
- The three primitives (Life, Cortex, Nerve) are irreducible.
  No primitive may be collapsed into another or demoted to a
  configuration artifact.
- Life MUST persist across Cortex replacements, Nerve additions/removals,
  and process restarts. It is the sole constant.

Rationale: This is the founding distinction from Koishi (respond),
AstrBot (chat), and generic agent frameworks (execute tasks).

### II. Cortex Owns the Cognitive Loop

The framework provides mounting points and lifecycle contracts but
MUST NOT constrain how a Cortex internally organizes cognition.

- There is NO framework-provided event→response pipeline, middleware
  chain, command routing, or message processing flow.
- Cortex self-manages event buffering — the framework provides zero
  queue/inbox/mailbox abstractions.
- Each Life binds at most one Cortex (enforced by `Life.bind()`).
- Different Cortex implementations (Chat, World, Interlude) MUST coexist
  on the same framework without the framework favoring any pattern.

Rationale: Three fundamentally different products share one framework.
Baking in any single cognitive pattern (e.g., request-response) would
make the others second-class.

### III. Capability Abstraction via Dependency Inversion

Cortex depends on abstract Capabilities; Nerves implement them.
This inversion MUST be maintained at all times.

- Cortex packages MUST depend on `capability-*` packages, NEVER on
  `nerve-*` or `adapter-*` packages.
- Non-IM capabilities (Minecraft, audio, Live2D) MUST be structurally
  equal to IM — no special framework support for messaging over others.
- Messaging is a removable Layer 2 plugin. The framework MUST remain
  functional without any IM capability installed.

Rationale: Prevents the "messaging is special" trap that makes
non-IM capabilities second-class citizens (Koishi's structural flaw).

### IV. Isolation as Architectural Guarantee

Multi-Life coexistence requires hard isolation boundaries enforced
by the framework, not by plugin discipline.

- Four keys (`life`, `cortex`, `message`, `satori`) MUST be isolated
  per Life group via Cordis `isolate` mechanism.
- Cortex accesses IM exclusively through `ctx.message` — NEVER
  `ctx.satori`, NEVER `ctx.bots`.
- No Service may call `ctx.mixin()` — global accessor names conflict
  across Life instances.
- Satori is confined inside `capability-message`; it is invisible
  to the rest of the framework.

Rationale: Without framework-enforced isolation, multi-Life deployment
is impossible — events leak, state corrupts, identity blurs.

### V. No Wrapping of Mature Ecosystems

Athena uses Cordis, Satori, and AI SDK directly. It MUST NOT introduce
abstraction layers over them.

- No wrapper around Satori Bot/Session/Methods.
- No LLM abstraction layer above AI SDK.
- No custom DI/lifecycle beyond what Cordis provides.
- Instance mechanisms use only standard Cordis primitives
  (`plugin-include` + `plugin-group` + `isolate`).

Rationale: Wrapping mature libraries duplicates maintenance burden,
lags upstream fixes, and adds cognitive overhead without adding value.
The framework's value is in *composition*, not *wrapping*.

## Architectural Constraints

These are non-negotiable structural rules. Violation breaks the
framework's guarantees:

1. **Cortex IM access**: Only through `ctx.message`. Direct
   `ctx.satori` or `ctx.bots` access is forbidden.
2. **Dependency direction**: Cortex → `capability-*` only.
   Never → `nerve-*` / `adapter-*`.
3. **One Cortex per Life**: Enforced by `Life.bind()`.
4. **No event→response pipeline**: Framework provides none.
5. **Self-managed buffering**: Cortex handles its own event queue.
6. **No `ctx.mixin()`**: Global accessor pollution forbidden.
7. **Multi-Life isolation**: `{ life, cortex, message, satori }`
   isolated per group.
8. **No Satori wrapping**: Use Bot/Session/Methods directly.
9. **No LLM wrapping**: Use AI SDK directly.
10. **Standard instance primitives only**: `plugin-include` +
    `plugin-group` + `isolate`.

### Degradation Test

Any change that moves the project toward ANY of these conditions
MUST be flagged, justified, and approved before merging:

1. Life reduced to a config file read once at Cortex startup
2. Cortex reduced to an ordinary event-subscribing plugin
3. Non-IM capabilities treated as second-class
4. Framework assumes event→response as the core flow
5. Memory/persona are static (no evolution infrastructure)

## Development Workflow

### Authority Order

When sources conflict, resolve by precedence:

```
Current code > User's latest instruction > docs/ > .specify/specs/
```

### Quality Gates

- All changes MUST pass `npx vitest run` before being considered complete.
- Build verification (`yarn build`) is required for changes affecting
  package structure or TypeScript declarations.
- New Services MUST have test coverage for: installation visibility,
  inject-not-satisfied deactivation, dispose cleanup, error paths,
  and isolation correctness.
- Cordis and Satori MUST NOT be mocked in tests — use real
  `new Context()`. Only external systems (HTTP, browsers, platforms)
  may be faked.

### Code Standards

- Pure ESM, `"type": "module"` everywhere.
- Formatting: double quotes, mandatory semicolons, `printWidth: 160`,
  `trailingComma: "all"`. Run `yarn format`; never hand-format.
- Code comments in English; documentation in Chinese
  (technical terms in English).
- Vendored code (`vendor/`) maintains upstream formatting;
  changes MUST be registered in `docs/02-architecture.md` §11.3.

### Documentation Sync

The following changes MUST update corresponding documentation:

| Change | Update target |
|--------|---------------|
| Add/remove package | `docs/02-architecture.md` §2, `docs/06-progress-and-roadmap.md` §1 |
| New Service/capability token | `docs/02-architecture.md` §6.1, `docs/04-patterns-and-recipes.md` |
| Modify vendored code | `docs/02-architecture.md` §11.3, `docs/05-lessons-learned.md` |
| New pitfall resolved | `docs/05-lessons-learned.md` §13 |
| Complete roadmap item | `docs/06-progress-and-roadmap.md` §4 |
| New design decision | `.specify/specs/` + `docs/appendix/C-decision-index.md` |

## Governance

This constitution is the supreme governance document for
athena-harness. It supersedes all other practices, conventions,
and informal agreements.

### Amendment Procedure

1. Propose the change with rationale and degradation-test impact.
2. Verify the change does not violate any degradation test condition.
3. Update this document with the change.
4. Increment version per semantic versioning (see below).
5. Record the decision in `docs/appendix/C-decision-index.md`.

### Versioning Policy

- **MAJOR**: Removal or incompatible redefinition of a core principle.
- **MINOR**: New principle/section added or materially expanded.
- **PATCH**: Clarifications, wording fixes, non-semantic refinements.

### Compliance Review

All contributions (human or AI agent) MUST be verifiable against
this constitution. The degradation test (§Architectural Constraints)
serves as the automated litmus test for architectural compliance.

**Version**: 1.0.0 | **Ratified**: 2026-08-22 | **Last Amended**: 2026-08-22
