# 04 · 工具设计

> Cortex 开发者参考手册。描述"LLM 的 tool 从哪来、谁控制可见性、怎么寻址"的推荐做法。
>
> 前置依赖：先读 [01-context-construction.md](./01-context-construction.md) 和 [02-multi-scene-attention.md](./02-multi-scene-attention.md)。
>
> 不是强制协议——Cortex 内部自治，可完整替换。
> 这里记录的是经验、理由和推荐默认值，不是规定。

---

## 问题：LLM 需要 Tool

Cortex 在 agent loop 中调用 LLM 时，需要提供一组 tool 供模型选择调用。这带来三个设计问题：

1. **来源**——tool 从哪里来？Cortex 自己定义的？还是外部插件贡献的？
2. **可见性**——哪些 tool 对哪个 Life 可见？插件在 Alice 的作用域内安装，Bob 能看到吗？
3. **寻址**——tool 的操作目标是谁？每次都要指定 channelId 和 botSid？

---

## 设计原则

### 1. 统一 Tool 模型

LLM 消费 tool 时，不区分"谁定义的"。所有 tool 都是 AI SDK `tool()` 的返回值，合并成一个 `ToolSet` 传给 `generateText`。

没有 Layer 1 / Layer 2 / Layer 3 的分层。分层是早期设计（基于"没有 focus、没有 Body 注册表"的旧假设），在当前架构下已不适用。详见[否决方案](#否决方案三层-tool-模型)。

### 2. Focus 提供默认寻址

主心智有 focus 频道（见 [cookbook 02](./02-multi-scene-attention.md)）。大部分 tool 的操作目标是当前 focus 场景——不需要每次都显式指定 channelId。

只有跨场景操作才需要显式寻址。LLM 在帧中看到 focus 标识，填充寻址参数不是负担。

### 3. 无 Tool Context 注入

Tool 不接受框架注入的 context。寻址信息由 LLM 通过参数提供（或省略以使用 focus 默认值），service 访问通过注册时闭包捕获的 Cordis context。

`abortSignal` 由 AI SDK v7 原生提供（`ToolExecutionOptions.abortSignal`），无需框架注入。

### 4. 平台能力通过 Body 访问

Cortex 代码直接通过 Body 方法调用平台能力：

```typescript
// 事件到达时，body 在 session 上
event.body.sendMessage(channelId, content);

// 需要主动寻址时
const body = ctx.nerve.get("onebot:123456") as OneBotBody;
await body.internal.setEssenceMsg(messageId);
```

Body 注册表 + `protocol-im` 的类型收窄已提供统一接口、平台特化、生命周期管理和能力检测。不需要额外的"结构化能力层"。

---

## 两种注册来源

### Cortex 内置 Tool

Cortex 自己定义的 tool，直接构造，不走 Registry。

特征：

- 与 Cortex 形态绑定（Chat 有 `send_message`/`wait`；World 有 `move`/`check_phone`）
- 闭包捕获 Cortex 的 focus 状态作为默认寻址
- 生命周期随 Cortex

```typescript
// 参数形态只有一种。不要靠"探测第一个参数有没有某个属性"来分派多态签名：
// Cortex 传进来的 ctx 是带 inject 白名单的 plugin Context，读取未声明的属性
// 会被 Cordis 直接拒绝，而单元测试常在 root Context 上装配，看不到这一点。
export function createCoreTools(ctx: Context, runtime: CoreToolRuntime, pacing?: PacingConfig): ToolSet {
  return {
    send_message: tool({
      description: "向频道发送消息。这是消息到达平台的唯一途径。",
      inputSchema: /* messages: string[], target?: SceneAddress, mode?, continue? */,
      execute: async (input) => {
        const target = input.target ?? runtime.logicalFocus();
        if (!target) return { ok: false, error: { name: "NoFocusError", message: "No focus Scene is available" } };
        const body = ctx.nerve.get(target.bodySid);
        if (!body || typeof body.sendMessage !== "function") {
          return { ok: false, error: { name: "BodyNotFound", message: `Body not found: ${target.bodySid}` } };
        }
        // 失败原样返回给模型：结构化错误，绝不返回伪造的 message id
        return { ok: true, messageIds: await body.sendMessage(target.channelId, parse(input.messages[0])) };
      },
    }),

    wait: tool({
      description: "显式沉默。本工具立即结束本轮，不发送任何消息。",
      inputSchema: /* reason: string */,
      execute: async () => ({ ok: true }),
    }),
  };
}
```

**"不回复"是一等决策。** `wait` tool 让沉默成为 LLM 的显式选择，而非超时或无 tool call 的副产物。

**Cortex 内置 tool 不闭包捕获 Cortex 实例，而是接受一个窄接口**（上面的 `runtime`）：读 logical focus、切 focus、读频道历史（`peek_channel` 经 message-store）、追加 workspace delta（同步 `appendWorkspaceDelta(messages: readonly ModelMessage[]): void`，内存数组）。这些写操作都必须经过唯一的 mutation owner（`TurnCoordinator` / runner 的 pending delta buffer），tool 不直接写 workspace——否则 turn 的串行写入顺序就没人保证了。`recordSceneCursor` 与 scene cursor 已删除（无 per-scene session store）。

### 插件贡献 Tool

第三方插件通过 `ctx.tools.register()` 注册的 tool。

特征：

- 来自外部插件（`plugin-onebot-utils`、`plugin-draw` 等）
- 通过注册时的 Cordis context 访问 service（活引用，非闭包捕获实例）
- 生命周期随插件（Cordis dispose 自动注销）
- 作用域由安装位置决定

```typescript
// plugin-onebot-utils
class OneBotUtilsPlugin {
  static inject = ["nerve", "tools"];

  constructor(ctx: Context) {
    ctx.tools.register(
      "set_essence",
      tool({
        description: "Pin a message as group essence",
        inputSchema: z.object({
          messageId: z.string(),
          botSid: z.string().describe("platform:selfId of the bot"),
        }),
        execute: async ({ messageId, botSid }) => {
          const body = ctx.nerve.get(botSid) as OneBotBody;
          await body.internal.setEssenceMsg(messageId);
          return { success: true };
        },
      }),
    );
  }
}
```

### Cortex 装配时合并

```typescript
const tools = {
  ...this.coreTools(),            // Cortex 内置
  ...this.ctx.tools.available(),  // 插件贡献
};

const result = await streamText({ model, messages, tools, ... });
```

LLM 看到的是统一的 tool 集合，不区分来源。

---

## Focus 与寻址

### Scene 身份：bodySid + channelId

寻址参数不是一个字符串 id，而是一对：

```typescript
interface SceneAddress {
  bodySid: string; // `${platform}:${selfId}`
  channelId: string;
}
```

不能用 `platform + channelId`：一个 Life 可以拥有多个同平台 Body，而它们可能各自持有同名 channel（两个 QQ 号都在群 `42` 里）。持久化 key 由单一模块编解码（`encodeSceneAddress` / `decodeSceneAddress`），业务代码不做 `split(":")`。给模型看的简写形式只是展示，不是身份。

### 默认操作于 logical focus

大部分 Cortex 内置 tool 省略寻址参数时作用于当前 **logical focus**：

```
send_message({ messages: ["你好"] })                                  → 发到 logical focus
send_message({ messages: ["..."], target: { bodySid, channelId } })   → 发到指定 Scene（跨场景）
```

**frame focus 与 logical focus 是两个字段。** turn 开始时冻结的帧描述 frame focus，`switch_focus` 只移动 logical focus 并追加 focusChange delta——本 turn 的帧不重建。新的 frame 在本 turn 结束后的重建事务里才建立：`promoteFocus()` 提升 frame focus，`history` 从 message-store 拉取新 focus 频道近期历史，`lastFocusHistory` 保存剪枝后的旧工作区。所以同一个 turn 里，"帧里写的 focus"和"send_message 的默认目标"可以不同，这是有意的：帧不变是上下文缓存与可复现性的前提。重建触发独立于压缩阈值——只要 `frameFocus !== logicalFocus` 就强制重建。

### 目标必须解析到唯一 Body

```typescript
const body = ctx.nerve.get(target.bodySid);
if (!body || typeof body.sendMessage !== "function") {
  return { ok: false, error: { name: "BodyNotFound", message: `Body not found: ${target.bodySid} channel ${target.channelId}` } };
}
```

三条硬规则：

- **不扫描 `ctx.nerve.bodies` 猜目标。** 猜错就是投递到错误的平台。
- **缺 Body、缺能力、平台拒绝都返回结构化失败**（带 `bodySid` 与 `channelId`，以及原始错误名/消息）。多条消息按序发送时，首条失败即停止并报告 `sent` + `failedAt`。
- **永不返回伪造的成功 id。** `mock:*` 之类的占位返回值会让模型以为自己说过话——它会据此继续对话，而对面什么都没收到。能力缺失必须表现为失败。

### 插件 Tool 的寻址策略

插件 tool 可以选择：

- **始终要求手动选址**——tool 参数中 `target` 为必填。LLM 在帧中看到 focus 标识和可用 body 列表，填充参数不构成决策负担。
- **接受 focus 作为默认**——如果插件能访问 Cortex 的 focus 状态（通过事件或约定），也可以把它作为默认值。但这引入了对 Cortex 内部状态的耦合，通常不推荐。

推荐做法：**插件 tool 使用手动选址。** 保持与 Cortex 的解耦。

### LLM 的信息来源

LLM 在帧中能看到：

- 当前 focus Scene 的 `bodySid` 与 `channelId`
- 可用 body 的列表（`platform:selfId`）
- 各 Scene 的 awareness 信息

这些信息足以让 LLM 正确填写寻址参数。

---

## `ctx.tools`：公共注册接口

### 职责

`ctx.tools` 是全局 Cordis Service，职责仅两项：

1. **注册/注销**——插件注册 tool，Cordis dispose 自动注销
2. **发现**——Cortex 装配时收集当前作用域内所有可用 tool

不负责执行——AI SDK 直接调用 tool 的 `execute` 函数。

### 接口形态

```typescript
interface ToolRegistry extends Service {
  /** 注册 tool，返回注销函数 */
  register(name: string, tool: CoreTool, options?: { override?: boolean }): () => void;

  /** 收集当前作用域可见的所有 tool，返回可直接 spread 的 ToolSet */
  available(): Record<string, CoreTool>;
}
```

- `name` 是 ToolSet 的 key（AI SDK 要求 `{ [key: string]: Tool }`）
- `tool` 是 AI SDK `tool()` 的返回值
- `available()` 返回的 `Record<string, CoreTool>` 可直接 spread 进 `generateText({ tools })`

### 作用域语义

`ctx.tools` 不 isolate（全局一个实例）。作用域过滤在 Registry 内部实现：

- 注册时记录 caller 所在 context 的 `life` isolate symbol
- 查询时比对 caller 的 `life` isolate symbol

效果：

```
Root Context（全局 tool 注册在此）
├── read_resource, describe_image          ← 所有 Life 可见
│
├── Alice Life Group（isolate: { life, cortex, nerve }）
│   ├── 安装 plugin-onebot-utils → 注册 set_essence  ← 仅 Alice 可见
│   ├── 安装 plugin-draw → 注册 draw_image           ← 仅 Alice 可见
│   └── CortexChat: coreTools() + ctx.tools.available()
│       → { send_message, wait, set_essence, draw_image, read_resource, describe_image }
│
└── Bob Life Group（isolate: { life, cortex, nerve }）
    ├── 安装 plugin-onebot-utils → 注册 set_essence  ← 仅 Bob 可见
    └── CortexChat: coreTools() + ctx.tools.available()
        → { send_message, wait, set_essence, read_resource, describe_image }
```

**"谁决定 Alice 有 draw 而 Bob 没有？"** ——用户，通过 Life 配置。Alice 的 group 配置中列了 `plugin-draw`，Bob 的没列。

### 命名冲突

- **先到先得 + 冲突报错**——同一作用域内注册同名 tool 时抛错
- **可选 `override: true`**——显式覆盖已有同名 tool

不同 Life group 各自注册同名 tool 不冲突——因为它们在不同作用域（不同 `life` isolate symbol）。

---

## 与检查点和每 turn 装配的关系

Tool schema 是 LLM request payload 的一部分，但不是 checkpoint 持久状态。`cortex-chat` 在每个 turn 都执行：

```text
buildPromptSnapshot(current persona, current compaction, checkpoint Frame)
assembleTools(ctx, runtime, ...)
generateText({ messages: [...stable, ...frame, ...workspace], tools })
```

因此：

- 在两个 turn 之间注册或注销 tool，下一 turn 的 provider request 会直接看到新集合；
- persona 或 compaction 变化，下一 turn 的 stable messages 会直接反映当前值；
- provider prompt/tool cache 是否命中，由实际 request payload 决定，不由 Athena checkpoint 发出额外失效信号；
- checkpoint（version 2）只保存恢复需要的 focus / history / lastFocusHistory / compaction，不保存 `stableFingerprint`；
- 不得因 tool/persona/模型配置变化而丢弃 checkpoint，否则会误删长期摘要、focus 与恢复边界。

### 什么不应放在 Tool Description 中

Tool description 会随每个 request 一起发送，仍应保持静态、简洁，避免把频繁变化的信息复制进每次调用。

**不应放**：

- 当前可用 Body 列表（频繁变化）
- 频道名称和状态（随时可能变）
- 任何运行时动态信息

**应放**：

- tool 的功能描述（静态）
- 参数的语义说明（静态）
- 使用约束和注意事项（静态）

动态信息的正确位置：

- **帧**：可用 Body、focus 与 scene 状态
- **工作区**：新消息、awareness、tool result 与状态 delta

### 不变式

每个 turn 使用当下真实的 prompt 与 tool payload；checkpoint 只负责认知状态恢复，不承担 provider cache invalidation。
---

## 否决方案：三层 Tool 模型

### 概念

早期设计将 tool 分为三层：

- **Layer 1**：Structured Capabilities——Cortex 代码调用的平台原语
- **Layer 2**：Product-Semantic Tools——Cortex 定义的 LLM tool，产品语义
- **Layer 3**：Platform Passthrough Tools——插件贡献的平台特有 LLM tool

Layer 2 直接传给 AI SDK，Layer 3 走 `ctx.tools` Registry。

### 为什么不再适用

1. **Focus 机制恢复了默认操作目标。** 三层模型的核心假设是"没有当前 channel 概念，每个 tool 必须完整寻址"。Focus 改变了这个前提——大部分操作有默认目标，不需要每次都传 channelId。

2. **Body 注册表已解决平台访问。** Layer 1 试图定义"Cortex 代码怎么访问平台能力"。现在答案很简单：`event.body.sendMessage()` 或 `ctx.nerve.get(sid)`。不需要额外的"结构化能力"抽象。

3. **"产品语义 vs 平台原生"是虚假二分。** 从 LLM 视角，`send_message` 和 `set_essence` 完全同质——都是可调用的 tool。从实现视角，两者也同质——都是调 Body 方法。区分只给开发者增加"我应该把 tool 放哪里"的认知负担。

4. **两条注册路径无谓复杂。** Layer 2 直接构造 + Layer 3 走 Registry，最后合并——说明 LLM 消费时它们就是同一种东西。简化为"内置 + 插件贡献"两种来源，统一合并。

5. **"Cortex 不理解 Layer 3 语义"是假命题。** Cortex 对所有 tool 的处理完全一样——收集并暴露给 LLM，执行 LLM 返回的 tool call。不存在"理解"或"不理解"的区别。

### 三次失败的 Tool Context 注入

详见 [05-lessons-learned.md](../05-lessons-learned.md) §9。YesImBot v3（session 合进参数）、v4 agent-runtime（ExecuteContext 第二参数）、v4 onebot-utils（闭包绑定 bot+scope）——三次设计都基于"一次执行 = 一个 channel = 一个 bot"的假设，在 Athena 的多场景架构下不适用。

当前设计的解决方式：

- Focus 提供默认目标（不是框架注入，是 LLM 自主选择的）
- Tool 通过参数接收寻址信息（LLM 决定目标）
- Tool 通过 Cordis context 访问 service（活引用，无需捕获实例）

---

## 待定事项

以下问题尚未决策，留待后续确认：

1. **`Context.current` 机制** — ✅ **已定**：`ToolRegistry.register()` / `available()` 通过 caller 的 Cordis context 判断作用域（root 注册 = 全局可见，Life 组内注册 = 仅该 Life 可见），实现见 `packages/core/src/tools.ts`。

2. **变化检测机制** — ✅ **已定**：不建立 checkpoint 指纹。prompt 与 tool 集合每 turn 从当前状态重装配，provider cache 根据真实 request payload 自行命中或失效。

3. **Tool 集合动态过滤** — 某些 turn 可能不该暴露所有 tool（如 rate limited 时收窄）。这应是 Cortex 装配时的过滤逻辑，不是 Registry 的职责。具体机制待定。

4. **Tool 命名约定** — ✅ **已定**：扁平命名。装配时如果插件 tool 与内置 tool 同名，抛诊断错误，不静默覆盖——覆盖掉 `send_message` 意味着这个 Life 从此说不出话。

---

## 参考来源

- [01-context-construction.md](./01-context-construction.md) — 三块模型、检查点语义
- [02-multi-scene-attention.md](./02-multi-scene-attention.md) — Focus 机制、检查点触发条件
- [05-lessons-learned.md](../05-lessons-learned.md) §9 — Tool Context 注入的三次失败
- `.specify/specs/technology-selection-and-tool-architecture.md` — D-14/D-15/D-16 历史决策
- `.specify/specs/satori-capability-architecture.md` D-08 — Layer 3 延后设计的原始记录
