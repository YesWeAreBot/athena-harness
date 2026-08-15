# Athena Harness Positioning

## One Sentence

Athena Harness is a Cordis-based, platform-neutral **digital life runtime kernel** for a mode-oriented ecosystem. It is not an AI agent assistant, not a chatbot framework, not a personal assistant product, and not an instant-messaging platform.

## Why This Matters

The current design and prototype intentionally live below application products. If Athena Harness becomes another chatbot framework or another assistant product, it will compete with Koishi, AstrBot, and OpenClaw instead of giving the community a shared execution kernel.

## Comparison

| Project          | Layer                                    | Core value                                                                                                                  | Relationship to Athena Harness                                                                                                             |
| ---------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Koishi           | Chatbot application framework            | Platform adapters, middleware, database, console, plugin ecosystem                                                          | Optional transport/adapter. Athena Harness should not reimplement Koishi's chat framework layer.                                           |
| AstrBot          | Python all-in-one Agent chatbot platform | IM integrations, LLM, MCP, skills, plugins, WebUI, sandbox                                                                  | Adjacent product/platform. It can be a host or source of adapters, but it is not the same layer.                                           |
| OpenClaw         | Personal AI assistant product            | Local Gateway, channels, tools/skills/plugins, device and companion apps                                                    | End-user assistant and control plane. It owns the user experience; Athena Harness owns execution semantics.                                |
| DeepSeek Harness | Agent harness product/framework          | Cordis-based, everything-is-a-plugin, Web UI, plugin ecosystem                                                              | Closest upstream. Athena Harness borrows selected kernel concepts but stays smaller and does not include DSH's application/product layers. |
| Athena Harness   | Digital life runtime kernel              | Durable life memory, perception/attention projection, life driver registry/factory, Mode registry, sense/actuator contracts | This project.                                                                                                                              |

## What We Are Not

- We are not another Koishi. We do not want to own chat adapters, middleware, or a full chatbot console.
- We are not another AstrBot. We do not want to become a Python all-in-one IM platform.
- We are not another OpenClaw. We do not want to own a personal assistant product, device control, or a specific end-user workflow.
- We are not an AI agent assistant. We do not optimize for tasks, prompts, or finishing a turn; we optimize for continuous existence.
- We are not a DeepSeek Harness clone. We use upstream Cordis and AI SDK directly, and we intentionally omit DSH's application, CLI, Web UI, and product-plugin layers until real consumers prove they are needed.

## What We Are

Athena Harness is the execution kernel for a mode-oriented digital life ecosystem:

- durable and replayable life memory;
- deterministic perception derived from memory;
- life driver lifecycle and owner-scoped handles;
- pluggable life loop providers;
- Mode, Body, Sense, Actuator, Model, Store, and WebUI contracts;
- Chat, World, and community life modes as equal plugins;
- Koishi or Satori as optional senses, not framework dependencies;
- IM as a door, not a home.

Body is the composable boundary between a life and its environment. A Body can be a chat account, a web account, a Minecraft avatar, a voice/camera device, or a physical shell. The core only sees Senses, Actuators, and Body State.

## Target Developer Experience

An ideal Athena Harness consumer should be able to compose a runtime like this:

```ts
ctx.plugin(lifeCore);
ctx.plugin(modeChat);
ctx.plugin(modeWorld);
ctx.plugin(bodySatori);
ctx.plugin(memoryJsonl);
ctx.plugin(bodyPhysicalShell);
ctx.plugin(webui);
```

The core does not know what Chat is. It does not know what World is. It only knows that a life mode can own a runtime style, perceive, act, and use shared framework services.

## Current Position

The repository is currently a small proof of the kernel:

- `Session` and `SessionStore` are real;
- `Surface` and `ModelSurface` are real;
- `AgentRegistry` and a placeholder `agentLoop` are real;
- Mode, Transport, persistence, tools, prompt composition, and WebUI are not implemented yet.

This is intentional. The next step is to make the kernel contracts solid enough that Chat and World can later be added as life modes without rewriting the core.

## See Also

- [Digital Life Vision](./vision.md)
