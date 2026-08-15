# Athena Harness Core — Design Spec

> 状态：已确认设计草案，待实现。
> 日期：2026-08-15
> 范围：`packages/` 下的六个 Harness Core 包，不含 `athena-runtime` 及任何产品 Mode。

---

## 1. 项目定位

Athena Harness Core 是建立在 Cordis 上的通用 Agent Loop 执行环境。它为可替换的 Agent Loop 提供运行所需的最小能力组合：Session 日志、工具注册、Prompt 组合、Session→ModelMessage 投影、持久化以及 Agent 执行控制。

它不是产品运行时，不包含 YesImBot、World、Interlude 的任何领域概念，不依赖 Koishi 或任何外部平台，也不实现调度、等待/唤醒或 Mode 切换。这些全部属于 `athena-runtime` 及其上层，本 spec 不涉及。

与 `@yesimbot/agent-runtime` 完全独立：不依赖、不兼容、不复制其类型。

---

## 2. 技术基础选型

| 技术 | 版本 | 用途 |
|---|---|---|
| `cordis` | `^4.0.0-rc.8`（上游，不 vendor） | 微内核：Plugin、Service、Context、Effect、生命周期 |
| `ai`（AI SDK） | `^7.0.0` | LanguageModel、Tool、ModelMessage、streamText |
| TypeScript | `^5.9` | 全量类型，ESM 模块 |

**Cordis 使用约束**（替代 DSH fork 的三个真实风险）：
1. 禁止在 Effect 的 disposer 函数内调用 `ctx.effect()`——`_unload()` 已 clear，新 effect 会永久泄漏。
2. Effect setup body 不得同步抛错——rc.8 先执行再注册 wrapper，setup 抛错时并发卸载的父 fiber 看不到该 effect。
3. 不得依赖兄弟 disposer 的异步完成顺序——`_unload()` 使用 `Promise.all`，只保证逆序启动，不保证完成顺序。

---

## 3. 包结构与依赖

六个包，全部 `private: true`，使用 `@athena/*` scope。

```
packages/
  session/        @athena/session
  tools/          @athena/tools
  prompt/         @athena/prompt
  agent/          @athena/agent
  agent-loop/     @athena/agent-loop
  persist-jsonl/  @athena/persist-jsonl
```

依赖方向严格向下，任何反向依赖均为错误：

```
persist-jsonl  →  session
agent-loop     →  agent, session, tools, prompt
agent          →  session
prompt         →  cordis
tools          →  cordis, ai (类型 only)
session        →  cordis, ai (类型 only)

全部包  →  cordis
全部包  ✗  athena-runtime, koishi, 任何产品概念
```

---

## 4. 各包接口契约

### 4.1 `@athena/session`

**职责**：append-only 执行日志、写入期不变量校验、Surface 投影、持久化接入点。

#### SessionEventMap（核心条目，其他包通过 `declare module` 扩展）

```typescript
interface SessionEventMap {
  'turn/start':        { turn: number }
  'turn/end':          { turn: number; reason: TurnEndReason }
  'step/start':        { turn: number; step: number }
  'step/end':          { turn: number; step: number }
  'assistant/message': { turn: number; step: number; message: AssistantModelMessage }
  'tool/call':         { turn: number; step: number; call: ToolCallPart }
  'tool/result':       { turn: number; step: number; result: ToolResultPart; status: ToolResultStatus }
  'request/header':    { turn: number; step: number; header: RequestHeader }
  'context/snapshot':  { turn: number; step: number; rendered: string }
  // 'user/message' 和 'env/observation' 由 @athena/agent 通过 declare module 贡献
}

type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted';    cause?: unknown }
  | { kind: 'error';      error: unknown }
  | { kind: 'max-tokens' }
  | { kind: 'max-steps';  limit: number }
  | { kind: 'interrupted' }

type ToolResultStatus = 'ok' | 'error' | 'interrupted'
```

#### SessionEvent

```typescript
interface SessionEvent<T = unknown> {
  readonly type:              string
  readonly seq:               number
  readonly time:              number
  readonly data:              T
  readonly surfaceOp?:        SurfaceOp   // 默认 'append'
  readonly sourceEventSeqs?:  readonly number[]
}

type SurfaceOp = 'append' | { replace: { start: number; end: number } }
```

#### Session

```typescript
interface Session {
  readonly id:      string
  readonly header:  SessionHeader

  // append-only 写入；违反不变量直接抛错（见 4.1.1）
  append<K extends keyof SessionEventMap>(
    type: K,
    data: SessionEventMap[K],
    opts?: AppendOptions,
  ): SessionEvent<SessionEventMap[K]>

  readonly events:  readonly SessionEvent[]
  readonly surface: Surface
  getEvent(seq: number): SessionEvent | undefined
  snapshot(): SessionSnapshot
}

interface AppendOptions {
  surfaceOp?:       SurfaceOp
  sourceEventSeqs?: readonly number[]
}
```

#### Surface

```typescript
// Surface 是 Session 日志的模型可见视图，通过 surfaceOp 动态维护。
// 它是日志的纯派生，不持有任何独立状态。
interface Surface {
  readonly nodes: readonly SurfaceNode[]   // replace 应用后的 seq 序列
  deriveMessages(
    projectors: ProjectorMap,
    agentKey?: symbol,
  ): ModelMessage[]
}

interface SurfaceNode {
  readonly seq: number
}

// 投影器：将一个 SessionEvent 投影为 ModelMessage 或 null（不可见）
type Projector<T = unknown> = (event: SessionEvent<T>) => ModelMessage | null

// 全局投影器 + per-agent 覆盖
interface ProjectorMap {
  global:  Map<string, Projector>
  scoped:  Map<symbol, Map<string, Projector>>
}
```

#### SessionRegistry（`ctx.sessions`）

```typescript
class SessionRegistry extends Service {
  static provide = 'sessions'

  create(opts?: { id?: string }): Session
  // restore 宽松接受（允许开放 turn，不重校不变量）
  restore(header: SessionHeader, events: readonly SessionEvent[]): Session
  get(id: string): Session | undefined
  remove(id: string): void

  // 持久化后端注册（单槽；重复注册抛错；返回 Cordis effect 清理函数）
  setPersistence(handler: SessionPersistenceHandler): () => void
}
```

#### SessionPersistenceHandler

```typescript
interface SessionPersistenceHandler {
  prepare(id: string): Promise<PreparedSession>
  create(header: SessionHeader): Promise<SessionBinding>
  open(id: string): Promise<SessionBinding>
}

interface PreparedSession {
  readonly header: SessionHeader
  readonly events: readonly SessionEvent[]
  close(): Promise<void>
}

interface SessionBinding {
  append(events: readonly SessionEvent[]): void   // 同步追加到写缓冲
  flush(): Promise<void>                          // 确保落盘；Loop 在 tool 执行前 await
  close(): Promise<void>
}
```

#### 4.1.1 写入期不变量（`append()` 内强制，违反直接抛）

| 条件 | 错误类型 |
|---|---|
| `step/*`/`tool/*` 引用的 turn 未以 `turn/start` 开启 | `TurnNotOpenError` |
| `tool/result` 无同 step 同 `toolCallId` 的前置 `tool/call` | `ToolCallMissingError` |
| `turn/end` 已写入后继续向该 turn 追加事件 | `TurnClosedError` |
| `surfaceOp.replace` 引用不存在的 seq | `InvalidReplaceRangeError` |

---

### 4.2 `@athena/tools`

**职责**：工具注册、per-agent scoped 可见性视图、运行时 tool gate。

```typescript
class ToolRegistry extends Service {
  static provide = 'tools'

  // key=undefined → 全局；key=agentKey → 仅该 Agent 可见
  register(name: string, tool: Tool, key?: symbol): () => void

  // descriptor-only ToolSet（无 execute）→ 送给 streamText，让 AI SDK 生成 tool call
  descriptors(key?: symbol, activeTools?: ReadonlySet<string>): ToolSet

  // 含 execute 的 ToolSet → Loop 执行时用
  executors(key?: symbol, activeTools?: ReadonlySet<string>): ToolSet

  names(key?: symbol): string[]
}
```

`descriptors()` 和 `executors()` 均合并 global 注册 + 指定 `key` 的注册，并按 `activeTools` 过滤（tool gate）。tool gate 是 World Mode 的 `open_app` 门控机制的基础。

工具类型直接使用 AI SDK 的 `Tool` / `ToolSet`，不建平行类型体系。

---

### 4.3 `@athena/prompt`

**职责**：System Prompt 的 section 组合，支持 per-agent scoped 贡献。

```typescript
interface PromptSection {
  readonly name:   string
  readonly order?: number                            // 排序权重，默认 0
  render(signal?: AbortSignal): string | Promise<string>
}

class SystemPrompt extends Service {
  static provide = 'systemPrompt'

  // key=undefined → 全局 section；key=agentKey → 仅该 Agent 生效
  add(section: PromptSection, key?: symbol): () => void

  // 组装并返回 system string + 内容指纹（rendered 不变时 Loop 跳过 context/snapshot）
  assemble(key?: symbol, signal?: AbortSignal): Promise<{
    system:   string
    rendered: string    // SHA 指纹或全文，用于 Loop 去重
    sections: Array<{ name: string; content: string }>
  }>
}
```

---

### 4.4 `@athena/agent`

**职责**：Agent 接口、Inbox、AgentRegistry、AgentFactory 替换缝。

#### Agent（纯接口，无执行逻辑）

```typescript
type AgentStatus = 'idle' | 'running' | 'stopping' | 'disposed'

interface Agent {
  readonly id:        string
  readonly session:   Session
  readonly model:     LanguageModel
  readonly maxSteps:  number
  readonly status:    AgentStatus
  readonly agentKey:  symbol          // 用于 tools/prompt scoped 注册

  // 向 next-turn 槽追加输入，唤醒 Loop，完整新 Turn
  followup(content: UserContent): void

  // 向 next-step 槽追加输入，唤醒 Loop，在当前 Turn 下一 Step 被 claim
  steer(content: UserContent): void

  // 向 next-step 槽追加输入，不唤醒（被动环境积累）
  inject(content: UserContent): void

  cancel(cause?: unknown): void
  whenIdle(): Promise<void>
}

interface AgentHandle {
  readonly agent: Agent
  dispose(): Promise<void>
}
```

#### SessionEventMap 扩展

```typescript
// @athena/agent 通过 declare module 贡献
declare module '@athena/session' {
  interface SessionEventMap {
    'user/message':    { content: UserContent }
    'env/observation': { content: UserContent }   // steer/inject claim 后追加
  }
}
```

#### Inbox

```typescript
// Inbox 持有两个有序槽，与执行闩解耦
// 实现细节私有，通过 Agent 方法访问
interface InboxTarget = 'next-turn' | 'next-step'
```

- `next-turn`：在 Turn 开头被整体 claim，追加为 `user/message`
- `next-step`：在每个 Step 开头被整体 claim，追加为 `env/observation`，投影为 `user` role

Inbox 不设容量上限；限速/拒绝策略是 Runtime 职责。

#### AgentFactory（Loop 替换缝）

```typescript
interface AgentFactory {
  createAgent(options: CreateAgentOptions): Promise<AgentHandle>
  resumeAgent(options: ResumeAgentOptions): Promise<AgentHandle>
}

interface CreateAgentOptions {
  id?:        string
  model:      LanguageModel
  maxSteps?:  number
  // setup 在 Agent 发布前运行；agentCtx 已含 ctx.agent
  // 可在此注册 scoped 工具/Prompt section
  setup?(agentCtx: Context): void | Promise<void>
}

interface ResumeAgentOptions {
  id:         string      // 必须有对应持久化记录
  model:      LanguageModel
  maxSteps?:  number
  setup?(agentCtx: Context): void | Promise<void>
}
```

#### AgentRegistry（`ctx.agents`）

```typescript
class AgentRegistry extends Service {
  static provide = 'agents'

  // 注册 AgentFactory（Loop 替换缝）；返回清理函数
  setFactory(factory: AgentFactory): () => void

  create(options: CreateAgentOptions): Promise<AgentHandle>
  resume(options: ResumeAgentOptions): Promise<AgentHandle>
  get(id: string): Agent | undefined
  list(): readonly Agent[]
}
```

---

### 4.5 `@athena/agent-loop`

**职责**：默认原生 Tool Call Loop 实现，注册为 AgentFactory。

#### 注册

```typescript
export const agentLoop = {
  inject: ['agents', 'sessions', 'tools', 'systemPrompt'] as const,
  apply(ctx: Context) {
    return ctx.agents.setFactory(new ReactLoopAgentFactory(ctx))
  },
}
```

#### Turn 执行顺序（意图先于副作用）

```
1. claimTurn()
   → 从 next-turn 槽取出全部消息
   → append 'user/message' × N

2. append 'turn/start' { turn }

3. for step = 1 .. maxSteps:
   a. claimStep()
      → 从 next-step 槽取出全部消息
      → append 'env/observation' × N

   b. assemble prompt（systemPrompt.assemble）
      → 若 rendered 与上次不同：append 'context/snapshot'

   c. append 'request/header' { turn, step, header }

   d. await binding?.flush()              ← 意图落盘（含 tool/call 意图）

   e. streamText({
        model,
        messages: surface.deriveMessages(),
        system,
        tools: ctx.tools.descriptors(agentKey, activeTools),  // descriptor-only
      })

   f. append 'assistant/message' { turn, step, message }

   g. for each toolCall in finalStep.toolCalls:
        append 'tool/call' { turn, step, call }
        await binding?.flush()             ← 每条 tool call 意图独立落盘
        output = await ctx.tools.executors(...)[toolCall.toolName].execute(...)
        append 'tool/result' { turn, step, result, status }

   h. append 'step/end' { turn, step }

   i. if finishReason !== 'tool-calls' or toolCalls.length === 0: break

4. append 'turn/end' { turn, reason }

5. await binding?.flush()
```

**关键设计点**：
- `streamText` 接收 descriptor-only tools（无 `execute`）；AI SDK 遇到无 execute 的 tool call 自然停止，每次调用恰好是一个 Step。
- `tool/call` 意图在 `tool.execute()` 之前写入并 flush，崩溃后 Session 里有意图记录但无结果。
- 崩溃恢复时 `restore()` 宽松接受开放 turn，Runtime 决定是补合成 `tool/result { status: 'interrupted' }` 还是截断未完成 Turn。

---

### 4.6 `@athena/persist-jsonl`

**职责**：JSONL 格式的 SessionPersistenceHandler 实现。

```typescript
export const persistJsonl = (config: { dir: string }) => ({
  inject: ['sessions'] as const,
  apply(ctx: Context) {
    ctx.sessions.setPersistence(new JsonlHandler(config))
  },
})
```

每个 Session 对应 `{dir}/{id}.jsonl`，每行一个 `SessionEvent`（JSON 格式）。

- `prepare(id)`：读文件、解析事件、返回 `PreparedSession`
- `create(header)`：创建文件、返回 `SessionBinding`（`append` = 追写行，`flush` = `fsync`）
- `open(id)`：打开已有文件、返回 `SessionBinding`（追加模式）

---

## 5. 目录布局

每个包统一结构：

```
packages/<name>/
  src/
    index.ts          ← 公开 re-export（按需分 entry point）
    types.ts          ← 纯类型，无运行时依赖
    *.ts              ← 实现模块（按职责拆分）
  test/
    *.test.ts         ← 行为测试
    contract.test.ts  ← 替换缝契约（agent / agent-loop 专有）
    teardown.test.ts  ← fiber 卸载无泄漏（agent / agent-loop 专有）
  package.json
  tsconfig.json
  tsconfig.build.json
```

`package.json` 的 `exports` 按需多 entry（如 `session` 包的 `./types` entry 供类型 only 消费者使用）。

---

## 6. 测试纪律

三类测试，不照搬 DSH 的可选 invariant 插件约定（不变量在 `session.append()` 内强制，属于接口契约，不可选）：

**行为测试**（`*.test.ts`）：跨公开接口，不 mock 内部状态，随实现重构不变。覆盖：

- `session`：不变量抛错、append 顺序、replace + deriveMessages 确定性、snapshot↔restore 往返
- `tools`：global + scoped + activeTools 过滤
- `prompt`：section 排序、scoped 覆盖、指纹去重
- `agent`：Inbox 三槽语义、followup/steer/inject 顺序
- `agent-loop`：取消、maxSteps、tool 执行、turn/end reason、意图先于副作用顺序
- `persist-jsonl`：append/flush/prepare 往返

**契约测试**（`contract.test.ts`，仅 `agent` / `agent-loop`）：

- 假 AgentFactory 注册后验证 AgentRegistry 的 create/resume/get/list 行为
- 假 Loop 验证发布顺序：session 创建早于 agent 发布

**teardown 测试**（`teardown.test.ts`，仅 `agent` / `agent-loop`）：

- Cordis fiber 卸载后无资源泄漏（无 pending promise、无未关闭 binding）
- `dispose()` 后调用 `followup`/`steer`/`inject` 正确抛错

---

## 7. 词汇表（落入各包 CONTEXT.md）

| 术语 | 定义 | 禁用别名 |
|---|---|---|
| **Session** | Agent 执行事实的 append-only 日志，是模型输入投影和崩溃恢复的唯一来源 | conversation, history, thread |
| **Surface** | Session 事件日志的模型可见视图，通过 `surfaceOp` 动态维护；是日志的纯派生，不是第二份状态 | context window, message history |
| **SurfaceOp** | 事件的投影指令：`'append'`（默认）或 `{ replace: { start, end } }`（压缩用） | compaction, pruning |
| **Turn** | 一次有边界的 Agent 激活；以 `turn/start` 开始，以 `turn/end` 结束；不等于一条用户消息 | request, invocation |
| **Step** | 一次模型请求及其直接结果边界；一个 Turn 含一或多个 Step | round, iteration |
| **AgentLoop** | 一次 Turn 的完整执行控制策略；通过 AgentFactory 替换；不等于 `streamText` 的一次调用 | runner, executor |
| **AgentKey** | 标识一个 Agent 的 `symbol`，用于在 tools/prompt 中隔离 per-agent 注册 | scope, realm |
| **Inbox** | Agent 持有的两槽输入缓冲（`next-turn` / `next-step`），与执行闩解耦 | queue, buffer, mailbox |
| **followup** | 向 `next-turn` 追加输入并唤醒；触发完整新 Turn | send, push |
| **steer** | 向 `next-step` 追加输入并唤醒；在当前 Turn 的下一 Step 开头被 claim | redirect, interrupt |
| **inject** | 向 `next-step` 追加输入，不唤醒；被动环境积累 | append, observe |
| **claim** | Loop 在 Turn/Step 开头从 Inbox 槽取出并清空消息的原子操作 | dequeue, consume |
| **ToolGate** | `activeTools` 过滤集，运行时限制模型可见工具；World Mode 的 `open_app` 依赖此机制 | tool filter, whitelist |
| **SessionBinding** | 对一个已打开持久化文件的写入句柄；拥有 `append`/`flush`/`close` | writer, handle |

---

## 8. 明确不在本 spec 范围内

以下内容属于 `athena-runtime` 及其上层，本 spec 不涉及：

- Life、Mode、ModeRegistry
- Body、PerceptEvent、Sense、Actuator
- 调度、等待、唤醒策略
- 产品状态（Channel、World、Story）
- 多 Agent 父子关系
- Koishi/OneBot Adapter
- 崩溃恢复的具体补偿策略（合成 `tool/result` vs 截断 Turn）

---

## 9. 已确认决策摘要

| # | 决策 |
|---|---|
| A2 | Loop 自持执行，工具 descriptor-only 传给 streamText，harness 自执行 |
| B1 | SessionEventMap 闭合 + `declare module` 扩展，编译期类型安全 |
| D2 | 6 个独立包，`@athena/*` scope |
| E1 | 上游 `cordis@4.0.0-rc.8`，不 vendor，遵守三条使用约束 |
| F1 | ToolRegistry 只做注册+视图，执行管线在 agent-loop |
| G1 | 写入期不变量在 `session.append()` 内强制，非可选 |
| H2 | `surfaceOp` 字段支持 `replace`，第一版不内置压缩策略 |
| I1 | `sessions.setPersistence(handler)` 单槽注册，无独立 Service |
| J1 | 三种输入语义：followup（next-turn+wake）/ steer（next-step+wake）/ inject（next-step, no-wake）|
| K3 | AgentFactory 是替换缝；agent 包声明接口，agent-loop 包提供实现 |
| L1+L3 | per-agent scoped 工具 + tool gate（activeTools），均在 ToolRegistry |
| M3 | 全部 6 个 core 包 + persist-jsonl 做到有测试才算第一阶段完成 |
| C1 | next-step claim 后追加 `env/observation` 到 Session |
| C2 | 简化 ownership，handle 持有者负责 dispose |
| C3 | restore 宽松，崩溃修复由 Runtime 负责 |
