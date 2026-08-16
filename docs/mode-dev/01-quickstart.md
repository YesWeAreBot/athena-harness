# 01 快速开始

## 这一节解决什么问题

你想第一次运行一个 Mode。

要做到这件事，你需要先回答三个问题：

1. 谁是这个数字生命？
2. 这个数字生命当前处于什么 Mode？
3. 外部世界怎么把这个 Mode 唤醒？

第一个问题的答案是 Life，第二个问题的答案是 Mode，第三个问题的答案是 Percept。

这一节先带你建立最小可运行环境，不深入实现细节。

## 为什么需要这些插件

athena-runtime 不是自带所有能力的单体框架。

它依赖 `@athena/*` 核心包提供：

- Session：记录数字生命的执行事实。
- Agent：执行 AgentLoop。
- AgentLoop：真正驱动模型、工具、Turn/Step。
- Tools：给模型提供工具。
- Prompt：组合系统提示词。
- Persistence：把 Session 写入磁盘。

athena-runtime 自己提供：

- Life：长期身份与资源所有权。
- Mode：运行策略组合容器。
- Memory、Scheduler、Delivery、Media 等能力面。

所以第一步是同时安装 `@athena/*` 核心插件和 athena-runtime 插件。

## 代码：安装插件

```ts
import { AgentRegistry } from "@athena/agent";
import { AgentLoop } from "@athena/agent-loop";
import { PersistJsonl } from "@athena/persist-jsonl";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import { Context } from "cordis";
import { mkdir } from "node:fs/promises";

import { lifeRegistry } from "@yesimbot/athena-runtime";
import { modeRegistry } from "@yesimbot/athena-runtime";

const sessionsDir = "./sessions";
await mkdir(sessionsDir, { recursive: true });

const ctx = new Context();
await Promise.all([
  ctx.plugin(SessionRegistry),
  ctx.plugin(ToolRegistry),
  ctx.plugin(SystemPrompt),
  ctx.plugin(AgentRegistry),
  ctx.plugin(AgentLoop),
  ctx.plugin(PersistJsonl({ dir: sessionsDir })),
  ctx.plugin(lifeRegistry),
  ctx.plugin(modeRegistry),
]);
```

这段代码做的事情：

- 创建一个 Cordis Context。
- 安装 Session、Tools、Prompt、Agent、AgentLoop。
- 安装 JSONL 持久化。
- 安装 LifeRegistry 和 ModeRegistry。

`PersistJsonl` 会让每个 Life Session 写入 `sessions/` 目录。

## 代码：注册最小 Mode

Mode 是一个定义，不是实例。

ModeRegistry 保存的是“如何创建某个 Mode”。真正创建 Mode 是在 Life 挂载它的时候。

```ts
import type { Mode } from "@yesimbot/athena-runtime";

const chatMode: Mode = {
  name: "chat",
  setup: async () => ({
    handle: async (event) => {
      console.log(event.kind, event.data);
      return true;
    },
  }),
};

ctx.modes.register(chatMode);
```

这里 `setup` 返回的对象就是 Mode 的运行句柄。

`handle` 是 Mode 处理 Percept 的入口。返回 `true` 表示这个 Percept 被处理了。

## 代码：创建 Life 并挂载 Mode

Life 是数字生命的身份。

`createWithAgent` 表示：这个 Life 创建时同时创建 Agent，并且 Agent 使用 `@athena/agent-loop` 作为默认执行循环。

```ts
const handle = await ctx.lives.createWithAgent({
  id: "athena-1",
  agentLoop: {
    model: myLanguageModel,
    maxSteps: 10,
  },
});

await handle.createMode("chat", {});
```

`createMode` 会：

1. 从 ModeRegistry 找到 `chat` 定义。
2. 创建 ModeContext。
3. 调用 `setup`。
4. 注册 Mode 声明的 providers。
5. 恢复 Mode 需要的状态和记忆。
6. 启动 Mode。

## 代码：发送 Percept

Percept 是外部世界的刺激。

你可以把它理解成“有人敲了一下门”。Life 负责把门铃声路由给当前 Mode。

```ts
await handle.dispatchPercept({
  id: "percept-1",
  time: Date.now(),
  bodyId: "im",
  kind: "message-created",
  data: { text: "你好" },
});
```

`bodyId` 表示来自哪个 Body。

`kind` 表示事件类型。

`data` 是事件内容。

Mode 可以通过 `ModePerceptInterest` 声明自己关心哪些 `bodyId + kind`。

## 代码：主动唤醒

不是所有行为都由外部事件触发。

Life 还允许你主动唤醒 Mode：

```ts
await handle.wake("world.tingle", { time: Date.now() });
```

`wake` 会被转换成一条 Percept，然后走和普通 Percept 完全相同的路由管线。

## 代码：释放

Life 销毁时，Mode 不应该是自己偷偷消失的。

Life dispose 会统一停止 Mode、释放 Agent、关闭 Binding、移除 Session。

```ts
await handle.dispose();
```

## 你现在应该理解什么

- Life 是身份，Mode 是运行方式。
- Mode 不是直接挂在 Context 上的，而是被 Life 挂载的。
- 外部输入通过 Percept 进入。
- 主动行为通过 wake 进入。
- 资源释放通过 Life dispose 统一完成。

下一节开始解释 Mode 的生命周期和它能声明哪些能力。
