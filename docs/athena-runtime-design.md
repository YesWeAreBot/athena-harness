# Athena Runtime Design

## Status

The canonical architecture baseline is [architecture-foundation.md](./architecture-foundation.md). This document records the current Athena Runtime prototype direction and should not override that baseline.

It is separate from `@yesimbot/harness-core`, which is now legacy and archived.
The canonical core reference is [docs/spark/2026-08-15-harness-core-design.md](./spark/2026-08-15-harness-core-design.md).

This is not an interface specification. Life, Mode, Body, and Memory contracts here are experimental prototypes until the canonical baseline confirms them.

## Purpose

Athena Runtime is the digital life framework layer, also understood as the next YesImBot core.

It absorbs YesImBot, YesImBotWorld, and HDS-Interlude as Mode consumers. It does not require them to share a common Agent Runtime; it only provides the Life, Mode, Body, Percept, and Memory contracts they can use.

## Layering

```text
@athena/* core
  generic agent-runtime toolkit
  Session, Tools, Prompt, Agent, AgentLoop, Persistence

Athena Runtime
  digital life framework
  Life, Mode, Body, Percept, Actuator, Memory, Scheduler

Mode consumers
  YesImBot, YesImBotWorld, HDS-Interlude, community Modes
```

Athena Runtime is the digital life layer. It consumes `@athena/*` core but does not implement a second agent-runtime inside athena-runtime.

## Current Architecture

The current architecture follows a **core thin, Mode thick** boundary:

- Life owns identity, Session, Binding, AgentHandle, Mode lifecycle, and Body attachment.
- Mode is a composition container: capabilities + providers + hooks + Life-owned context.
- Memory is a Life facade with Mode-specific providers.
- Body/Percept/Actuator are extensible envelopes, not closed product types.
- AgentLoop is the canonical `@athena/agent-loop`; Life binds its own Session to the loop.
- MediaStore provides file-level media persistence for images, audio, video, and files.
- `@athena/agent-loop` emits agent/stream-part and agent/output events.
- Life serializes lifecycle operations and exposes an explicit `disposed` state.
- Life emits observability events for creation, disposal, routing, rejection, and errors.

## Life

A Life is a stable digital life identity with a Session-backed memory handle.

Confirmed contracts:

- `LifeRegistry` creates, resumes, lists, and disposes Lives;
- a `LifeHandle` owns its Life and can hold one active `ModeHandle`;
- a Life can attach Body ids;
- `LifeRegistry` routes matching `body/percept` events to that Life's active Mode.
- LifeHandle serializes lifecycle operations and exposes an explicit `disposed` state.
- `LifeHandle.wake()` routes a Life-level wake Percept through the same attention/compact/Mode pipeline.
- `LifeHandle.setModel()` resolves the active Mode model provider and emits `model/changed`.
- `LifeHandle.getState/setState/deliver()` delegate to active Mode state and delivery providers.

## AgentLoop Wiring

`LifeRegistry.createWithAgent()` and `resumeWithAgent()` wire a Life to the canonical
`@athena/agent-loop`:

- Life creates or restores its Session first.
- Life creates the persistence Binding when a persistence handler is installed.
- Life passes the external Session and Binding to `ctx.agents.create()` / `resume()`.
- Life owns the Session and removes it on dispose.
- AgentLoop owns the AgentHandle and execution state, and does not remove an externally owned Session.
- Life dispose releases the Mode, AgentHandle, Binding, and Session in order.

## Mode

A Mode is a registered definition, not a core implementation.

Confirmed contracts:

- `ModeRegistry` registers Mode definitions;
- `ModeRegistry.create()` instantiates a registered definition into a `ModeHandle`;
- a `ModeHandle` may expose `start`, `stop`, and `handle(percept)`;
- a `ModeSetupHandle` may expose `hooks.onPercept` and `providers.memory`;
- Mode memory providers are registered into the Life memory facade and unregistered when the Mode is disposed;
- Mode capabilities may declare model roles, state kinds, and delivery kinds;
- Mode providers may declare model, state, and delivery implementations;
- Life falls back to global model/state/delivery provider registries when no active Mode provider matches;
- Delivery providers return a receipt and may support schedule/cancel for delayed delivery;
- Delivery providers may declare canDeliver(target) so Life routes cross-conversation deliveries by target;
- DeliveryQueue persists scheduled deliveries and fires them when due;
- Mode state providers may expose restore(lifeId); Life calls it before starting the Mode;
- Mode state providers may expose persist(lifeId); ModeRegistry calls it before provider disposal;
- Life persists the old Mode state and restores the new Mode state when switching Modes;
- Mode providers may declare media implementations; ModeContext.media reads the active Mode provider;
- Mode providers may declare a scheduler implementation; ModeContext.scheduler prefers it and falls back to the Life scheduler;
- ModeContext reserves model, state, delivery, and media access surfaces for Mode-specific composition;
- Chat, World, and Interlude are future Mode consumers.

Mode-specific behavior is not part of Athena Runtime core.

## Body, Percept, and Actuator

Body is the composable boundary between a Life and its environment:

```text
Body = Senses + Actuators + Body State
```

Confirmed contracts:

- `BodyRegistry` registers Bodies and dispatches `body/percept` events;
- `BodyRegistry.act()` returns a unified `ActuatorResult` with ok/error/canceled status, optional retry, and optional abort signal;
- Actuator implementations return `ActuatorResult`; error results marked `retryable` are retried by BodyRegistry;
- `PerceptEvent` carries optional source, priority, target, media, and meta envelope fields;
- `ActuatorContext` carries body/life/mode/delivery/media context when supplied;
- `PerceptEvent` is not a chat event;
- IM, Bilibili, Xiaohongshu, Minecraft, voice/camera devices, and physical shells are all Body implementations;
- the core does not implement any specific Body.

## Memory

Session Log is the low-level durable fact store provided by Harness core.

A minimal LifeMemory infrastructure now exists above the Session Log: it defines identity, biography, preference, relationship, and derived records, with in-memory and JSONL providers. `LifeMemory.ingestPercept()` provides Mode-driven Percept ingestion and records the source Body id/kind without copying full Body state. LifeMemory also registers Mode-specific `MemoryProvider`s and routes recall by scope; Derived memory, compaction, and production stability are still pending.

LifeMemory is the unified Life facade. Mode providers contribute scoped storage such as
`conversation`, `world`, `story`, `participant`, and `facts`; Life routes recall by scope and
unregisters providers when the owning Mode is disposed.

LifeMemory does not implement memory strategy. Derived memory, compaction, and forgetting are
optional `MemoryProvider` capabilities; LifeMemory only routes `derive()` and `compact()` to the
providers that support them.

When a Mode registers its MemoryProvider through `LifeHandle.createMode()`, Life calls
`ctx.memory.restore(lifeId)` before starting the Mode. Each provider restores its own persistent
format; Life does not interpret provider-specific memory data.

## Confirmed Decisions

- 2026-08-15: Athena Runtime is the digital life framework layer and next YesImBot core.
- 2026-08-15: LifeRegistry and ModeRegistry are core contracts.
- 2026-08-15: ModeRegistry.create() and LifeHandle Mode routing are confirmed.
- 2026-08-15: LifeHandle Body attachment and automatic `body/percept` routing are confirmed.
- 2026-08-15: ModeRegistry creates tracked ModeHandles with id, name, and idempotent dispose(); LifeHandle stops the old Mode before starting a new one and clears activeMode if start fails.
- 2026-08-15: BodyRegistry executes registered Actuators through act(); Body and Mode disposal emit body/disposed / mode/disposed so LifeRegistry reacts to Cordis plugin hot unload.
- 2026-08-15: LifeMemory, SchedulerRegistry, and AgentLoopRegistry are added as early Mode infrastructure; they are not product Mode implementations.
- 2026-08-16: Mode capabilities gate Percept routing and Actuator access; LifeRegistry emits life/error for async routing failures.
- 2026-08-16: LifeRegistry emits life/created, life/disposed, and percept/routed events; BodyRegistry emits actuator/executed.
- 2026-08-16: Life supports a simple attention/compact PerceptPipeline before Mode interest routing.
- 2026-08-16: Life emits percept/rejected when attention, capabilities, or missing Mode prevents routing.
- 2026-08-16: LifeMemory exposes registerProvider/unregisterProvider/listProviders so Modes can contribute scoped memory while Life remains the unified facade.
- 2026-08-16: Mode hooks and Mode providers are the first composition seams beyond setup/handle.
- 2026-08-16: Mode boundary is defined as capabilities + providers + hooks + Life-owned context, not a shared internal execution flow.
- 2026-08-16: Mode scheduler providers are cancelled when the Mode is disposed.
- 2026-08-16: LifeHandle.wake and LifeHandle.setModel are the first Life-owned active behavior and model switching entry points.
- 2026-08-16: LifeHandle exposes getState/setState/deliver as Life-owned access to active Mode providers.
- 2026-08-16: Mode media providers are available through ModeContext.media without entering Life core.
- 2026-08-16: global ModelProviderRegistry, StateProviderRegistry, and DeliveryProviderRegistry provide fallback resolution.
- 2026-08-16: Mode providers receive dispose() when the Mode is disposed; scheduler providers are also cancelled.
- 2026-08-16: model switching emits model/changed and model/error events.
- 2026-08-16: MediaStore supports save/get/list/delete over a configurable filesystem root.
- 2026-08-16: Memory strategy stays in MemoryProvider; LifeMemory only routes and manages lifecycle.
- 2026-08-16: Life triggers MemoryProvider.restore on Mode create; providers own their restore format and persistence.
- 2026-08-16: Life triggers ModeStateProvider.restore on Mode create; providers own state persistence.
- 2026-08-16: ModeRegistry persists state providers before disposing them.
- 2026-08-16: Delivery providers expose deliver/schedule/cancel through ModeContext and LifeHandle; Life only delegates.
- 2026-08-16: Delivery routing considers canDeliver(target) for cross-conversation delivery.
- 2026-08-16: Mode switching persists old state providers and restores new state providers.
- 2026-08-16: JsonlStateProvider provides per-Life JSON persistence for Mode state.
- 2026-08-16: DeliveryQueue persists pending deliveries and restores timers after restart.
- 2026-08-16: @athena/agent-loop emits stream-part and output events.

## Pending

- Derived Memory, compaction, and forgetting policy;
- WebUI;
- provider cooldown and delivery queue persistence;
- delivery permission registry beyond provider-local canDeliver;
- Mode-specific behavior.
- Chat, World, and Interlude Mode contract tests that verify the Mode boundary without importing product internals.
- MediaStore search, gallery, captioning, and MediaAccess integration.

## Initial Internal Layout

```text
packages/athena-runtime/
  src/
    index.ts
    agent-loop/
      index.ts
      types.ts
    body/
      index.ts
      types.ts
    delivery-provider/
      index.ts
    life/
      index.ts
      types.ts
    media-store/
      index.ts
    memory/
      index.ts
      jsonl.ts
      record.ts
      types.ts
    mode/
      index.ts
      types.ts
    model-provider/
      index.ts
    scheduler/
      index.ts
      types.ts
    state-provider/
      index.ts
  test/
```
