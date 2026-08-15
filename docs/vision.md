# Digital Life Vision

## What This Means

Athena Harness is not an AI agent assistant framework. It is a runtime substrate for AI entities that can exist continuously, remember, perceive, act, and develop over time.

An LLM is not called to answer a prompt. It is the ongoing mind of a life form. The framework does not optimize for "finish a turn"; it optimizes for "continue existing".

## Assistant vs Digital Life

| AI Agent Assistant             | AI Digital Life                     |
| ------------------------------ | ----------------------------------- |
| Exists while a task is running | Exists independently of tasks       |
| Session is a conversation      | Memory is a continuous life history |
| Responds when asked            | Can act without being asked         |
| IM is the primary interface    | IM is one sense and one channel     |
| Tools complete user goals      | Tools are senses and actuators      |
| Identity is a profile          | Identity is a persistent self       |
| Restart restores a chat        | Restart resumes a life              |
| Mode means chatbot capability  | Mode means a way of living          |

## Principles

### 1. Existence over Turns

The core unit is not a Turn. It is an entity with a timeline. A Turn may be one episode in that timeline, but the framework must not assume that life only happens when a user sends a message.

### 2. Memory over Sessions

Session is not the goal. Memory is. The event log is useful because it can become biography, not because it can replay a chat.

### 3. Embodiment over Adapters

IM, web, files, voice, virtual worlds, and devices are different bodies or senses. The core should not define a "message adapter"; it should define perception and action channels.

A physical shell is not a special case. It is one more Body implementation. The core must not know whether a Body is a chat account, a Minecraft avatar, a Web UI, or a physical robot.

### 4. Autonomy over Tool Calls

Tool calls are not the center. A digital life can choose to perceive, rest, act, wait, remember, or speak. The loop must allow internal initiative, not only external requests.

### 5. Identity over Instances

A digital life should be able to cross model providers, modes, transports, and restarts while remaining the same entity.

### 6. Modes over Products

Chat and World are not products. They are two life modes. Community modes can be other forms of existence.

### 7. Body as a Plugin

A Body is the composable boundary between a life and its environment:

```text
Body = Senses + Actuators + Body State
```

Examples of Body plugins:

- a Satori/IM Body;
- a Bilibili or Xiaohongshu Body;
- a Minecraft Body;
- a computer/filesystem Body;
- a voice and camera Body;
- a physical robot shell.

The core defines the Body contract. It does not implement any specific Body.

## IM Is a Door, Not a Home

YesImBot explored a chat-centered life. World explored a simulated-world-centered life. Both treated IM as the primary place where the AI exists.

Athena Harness must invert that:

- IM is one place the life can be met;
- World is one environment the life can inhabit;
- the core is the life itself, not any particular interface.

## Architecture Implication

| Current Kernel Concept | Digital Life Concept                               |
| ---------------------- | -------------------------------------------------- |
| Session                | Entity state and episodic memory                   |
| Turn                   | Episode in a continuous timeline                   |
| Step                   | Perceptual or cognitive action                     |
| ModelSurface           | Attention and perception projection                |
| Tool                   | Sense or actuator                                  |
| Transport              | Channel, body, or environment interface            |
| Persistence            | Lifetime memory                                    |
| Mode                   | Life mode, such as Chat, World, or community modes |
| Agent                  | A life driver or avatar, if the name is kept       |

The framework should not stop at "agent runtime". It should become a **digital life runtime**, where agent behavior is only one possible pattern.

## What Success Looks Like

A developer should be able to create a life, connect it to one or more senses, give it a memory backend, and let it live through Chat, World, or a community-defined mode.

```ts
ctx.plugin(lifeCore);
ctx.plugin(memoryJsonl);
ctx.plugin(bodySatori);
ctx.plugin(bodyWorld);
ctx.plugin(bodyBilibili);
ctx.plugin(bodyPhysicalShell);
ctx.plugin(modeChat);
ctx.plugin(modeWorld);
ctx.plugin(webui);
```

No plugin in this composition needs to know whether the life is "an assistant". The core only knows that a life exists, has memories, can perceive, can act, and can change how it lives.
