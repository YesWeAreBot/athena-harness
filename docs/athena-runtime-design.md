# Athena Runtime Design

## Status

The canonical architecture baseline is [architecture-foundation.md](./architecture-foundation.md). This document records the current Athena Runtime prototype direction and should not override that baseline.

It is separate from [docs/design.md](./design.md), which describes `@yesimbot/harness-core`.

This is not an interface specification. Life, Mode, Body, and Memory contracts here are experimental prototypes until the canonical baseline confirms them.

## Purpose

Athena Runtime is the digital life framework layer, also understood as the next YesImBot core.

It absorbs YesImBot, YesImBotWorld, and HDS-Interlude as Mode consumers. It does not require them to share a common Agent Runtime; it only provides the Life, Mode, Body, Percept, and Memory contracts they can use.

## Layering

```text
Harness core
  generic agent-runtime toolkit
  Session Log, ModelSurface, Tools, Prompt, Persistence, replaceable AgentLoop

Athena Runtime
  digital life framework
  Life, Mode, Body, Percept, Actuator, Memory

Mode consumers
  YesImBot, YesImBotWorld, HDS-Interlude, community Modes
```

Harness core is an agent-runtime. Athena Runtime is the digital life layer. They should not be confused.

## Life

A Life is a stable digital life identity with a Session-backed memory handle.

Confirmed contracts:

- `LifeRegistry` creates, resumes, lists, and disposes Lives;
- a `LifeHandle` owns its Life and can hold one active `ModeHandle`;
- a Life can attach Body ids;
- `LifeRegistry` routes matching `body/percept` events to that Life's active Mode.

## Mode

A Mode is a registered definition, not a core implementation.

Confirmed contracts:

- `ModeRegistry` registers Mode definitions;
- `ModeRegistry.create()` instantiates a registered definition into a `ModeHandle`;
- a `ModeHandle` may expose `start`, `stop`, and `handle(percept)`;
- Chat, World, and Interlude are future Mode consumers.

Mode-specific behavior is not part of Athena Runtime core.

## Body, Percept, and Actuator

Body is the composable boundary between a Life and its environment:

```text
Body = Senses + Actuators + Body State
```

Confirmed contracts:

- `BodyRegistry` registers Bodies and dispatches `body/percept` events;
- `PerceptEvent` is not a chat event;
- IM, Bilibili, Xiaohongshu, Minecraft, voice/camera devices, and physical shells are all Body implementations;
- the core does not implement any specific Body.

## Memory

Session Log is the low-level durable fact store provided by Harness core.

Athena Runtime Memory is not yet implemented. It will sit above the Session Log and represent identity, biography, preferences, relationships, and derived state.

## Confirmed Decisions

- 2026-08-15: Athena Runtime is the digital life framework layer and next YesImBot core.
- 2026-08-15: LifeRegistry and ModeRegistry are core contracts.
- 2026-08-15: ModeRegistry.create() and LifeHandle Mode routing are confirmed.
- 2026-08-15: LifeHandle Body attachment and automatic `body/percept` routing are confirmed.
- 2026-08-15: ModeRegistry creates tracked ModeHandles with id, name, and idempotent dispose(); LifeHandle stops the old Mode before starting a new one and clears activeMode if start fails.
- 2026-08-15: BodyRegistry executes registered Actuators through act(); Body and Mode disposal emit body/disposed / mode/disposed so LifeRegistry reacts to Cordis plugin hot unload.

## Pending

- Memory ingestion and derived Memory;
- automatic Life to AgentLoop wiring;
- WebUI;
- model provider and model hot-switching;
- Mode-specific behavior.

## Initial Internal Layout

```text
packages/athena-runtime/
  src/
    index.ts
    body/
      index.ts
      types.ts
    life/
      index.ts
      types.ts
    mode/
      index.ts
      types.ts
  test/
```
