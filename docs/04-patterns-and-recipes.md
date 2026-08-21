# 可复用模式与代码片段

> 本文的片段与仓库真实 API 一致，可直接复制。规范背景见 [03-code-conventions.md](./03-code-conventions.md)。
>
> 标注 `【规划中】` 的片段对应尚未实现的 API，仅作目标形态参考，**不要**直接使用。

---

## 目录

1. [定义一个 Cordis Service](#1-定义一个-cordis-service)
2. [定义一个 Cortex](#2-定义一个-cortex)
3. [定义一个 Capability Service](#3-定义一个-capability-service)
4. [定义一个 Nerve](#4-定义一个-nerve)
5. [使用 AI SDK v7](#5-使用-ai-sdk-v7)
6. [Multi-Life 部署配置](#6-multi-life-部署配置)
7. [测试模式](#7-测试模式)
8. [常用工具片段](#8-常用工具片段)

---

## 1. 定义一个 Cordis Service

### 1.1 最小 Service

```typescript
import { Context, Service } from "cordis";

declare module "cordis" {
  interface Context {
    greeter: Greeter;
  }
}

export default class Greeter extends Service {
  constructor(ctx: Context) {
    super(ctx, "greeter");
  }

  greet(name: string): string {
    return `Hello, ${name}`;
  }
}
```

安装：

```typescript
await ctx.plugin(Greeter);
ctx.greeter.greet("world");
```

### 1.2 带 Config Schema

```typescript
import { Schema } from "@athena-ai/core";
import { Context, Service } from "cordis";

declare module "cordis" {
  interface Context {
    greeter: Greeter;
  }
}

export interface Config {
  prefix: string;
  loud?: boolean;
}

export default class Greeter extends Service<Config> {
  public static readonly Config: Schema<Config> = Schema.object({
    prefix: Schema.string().default("Hello"),
    loud: Schema.boolean().default(false),
  });

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "greeter");
  }

  greet(name: string): string {
    const text = `${this.config.prefix}, ${name}`;
    return this.config.loud ? text.toUpperCase() : text;
  }
}
```

要点：

- `Schema` 从 `@athena-ai/core` 导入（它重导出 schemastery）
- ⚠️ **cordis v4 的 `Service<T>` 基类不提供 `this.config`** —— 它只声明 `[Service.config]: T` 这个类型标记。想用 `this.config` **必须**自己在构造函数里写 `public config: Config`。仓库中 `Life`（`plugins/life/src/life.ts:27-28`）与 `SandboxHub`（`plugins/sandbox/src/index.ts:91-92`）都是这个写法
- `Service<Config>` 的泛型参数只影响 `intercept` 的配置类型推导，不生成实例属性

### 1.3 带依赖声明

```typescript
export default class Greeter extends Service<Config> {
  /** 必需依赖 —— 缺失时 fiber 停在 PENDING，service 不激活 */
  static inject = ["life"];

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "greeter");
    // ctx.life 在此处保证可用
    const name = ctx.life.persona.name;
  }

  /**
   * 可选依赖：cordis v4 无 `static optional`，用 ctx.get() 探测。
   * 直接写 `this.ctx.message` 会抛 `cannot get property "message" without inject`。
   */
  maybeSend(channelId: string, text: string) {
    const message = this.ctx.get("message");
    if (!message) return;
    return message.createMessage(channelId, text);
  }
}
```

可选依赖的另一种表达 —— 嵌套 `ctx.inject()` 子 fiber，依赖可用时才激活，不可用时自动卸载：

```typescript
constructor(ctx: Context) {
  super(ctx, "greeter");

  // 只有当 'minecraft' 可用时，这个子 fiber 才激活
  ctx.inject(["minecraft"], (scoped) => {
    scoped.on("minecraft/block-change", (event) => this.onBlockChange(event));
  });
}
```

### 1.4 需要清理的初始化：`*[Service.init]()`

```typescript
import { Context, Service } from "cordis";

export default class Ticker extends Service {
  constructor(ctx: Context) {
    super(ctx, "ticker");
  }

  *[Service.init]() {
    const timer = setInterval(() => this.tick(), 1000);
    // yield 出去的函数在 fiber dispose 时自动执行
    yield () => clearInterval(timer);
  }

  private tick() {
    this.ctx.logger("ticker").debug("tick");
  }
}
```

要点：

- 构造函数中的 `ctx.on(...)` / `ctx.plugin(...)` **无需**手动清理，随 fiber 自动释放
- 只有外部资源（timer、socket、第三方注册）需要 yield disposer
- 无需清理时写裸 `yield;`
- **不要**自定义 `start()` / `stop()` / `dispose()`

### 1.5 `ctx.effect()` —— 构造函数中注册清理逻辑

当清理逻辑写在构造函数里更自然时（例如向外部 Hub 注册）：

```typescript
constructor(private ctx: Context) {
  const unregister = ctx.sandbox.register(this._lifeId, handle);

  ctx.effect(() => {
    return () => {
      unregister();
      for (const handle of Object.values(this._handles)) {
        handle.fiber.dispose();
      }
      this._handles = Object.create(null);
    };
  }, "sandbox-nerve.cleanup");
}
```

第二个参数是给 cordis 调试用的标签，建议写 `<包名>.<用途>`。

### 1.6 保留构造时 context

若逻辑依赖构造时的 context（解析 isolate symbol、查特定 domain 的 service），必须自存引用：

```typescript
export default class MessageService extends Service<Config> {
  /**
   * Cordis rebinds `this.ctx` to the caller's context when the service is
   * reached through a traceable proxy, and that context may not resolve the
   * `satori` isolate. Keep our own reference.
   */
  private _self: Context;

  constructor(ctx: Context) {
    super(ctx, "message");
    this._self = ctx;
  }

  get bots() {
    return this._self.get("satori")?.bots ?? [];
  }
}
```

### 1.7 非 Service 插件

不提供 service，只做副作用：

```typescript
import type { Context } from "cordis";

export default class MyPlugin {
  public static readonly name = "my-plugin";
  public static readonly inject = ["life", "message"];

  constructor(private ctx: Context) {
    ctx.on("message", (session) => {
      // ...
    });
  }
}
```

或函数式（无状态时）：

```typescript
export function apply(ctx: Context, config: Config) {
  ctx.on("message", (session) => {
    /* ... */
  });
}
```

### 1.8 配套的 package.json

```json
{
  "name": "@athena-ai/plugin-greeter",
  "version": "0.0.1",
  "type": "module",
  "main": "./lib/index.cjs",
  "module": "./lib/index.js",
  "types": "./lib/index.d.ts",
  "exports": {
    ".": {
      "types": "./lib/index.d.ts",
      "import": "./lib/index.js",
      "require": "./lib/index.cjs"
    },
    "./package.json": "./package.json"
  },
  "dependencies": {
    "@athena-ai/protocol": "workspace:*"
  },
  "peerDependencies": {
    "cordis": "^4.0.0-rc.8"
  },
  "cordis": {
    "service": {
      "implements": ["greeter"],
      "required": ["life"],
      "optional": ["message"]
    }
  }
}
```

和 `tsconfig.json`：

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "lib"
  },
  "include": ["src"]
}
```

---

## 2. 定义一个 Cortex

### 2.1 骨架（对应当前 `cortex-chat` 实现）

```typescript
import type {} from "@athena-ai/capability-message";
import { Schema } from "@athena-ai/core";
import { Cortex } from "@athena-ai/protocol";
import { Session } from "@satorijs/core";
import { Context } from "cordis";

declare module "cordis" {
  interface Context {
    cortex: CortexChat;
  }
}

export interface Config {}

export default class CortexChat extends Cortex {
  static name = "cortex-chat";

  static inject = ["life", "message"];

  static Config: Schema<Config> = Schema.object({});

  constructor(ctx: Context) {
    super(ctx, "cortex");

    // 订阅传入消息
    ctx.on("message", (session: Session) => {
      this.onMessage(session);
    });
  }

  private async onMessage(session: Session) {
    // 跳过自己发的消息
    if (session.userId === session.selfId) return;

    const persona = this.ctx.life.persona;
    const content = session.content ?? "";

    try {
      await this.ctx.message.createMessage(session.channelId!, `[${persona.name}] Echo: ${content}`, session.bot?.sid);
    } catch (e) {
      this.ctx.logger("cortex-chat").warn("Failed to reply:", e);
    }
  }
}
```

关键点：

- 继承 `Cortex`（来自 `@athena-ai/protocol`），**不是**直接继承 `Service`
- `super(ctx, "cortex")` —— provide key 固定是 `"cortex"`
- `static inject` 必须包含 `"life"`（基类要求）+ 你需要的 capability
- **不要**自己调 `ctx.life.bind()` —— 基类的 `*[Service.init]()` 已处理
- `import type {} from "@athena-ai/capability-message"` 引入 `ctx.message` 类型增强
- 需要读配置时**自己声明** `public config: Config` —— `Cortex` 基类的构造函数签名是 `(ctx, name)`，不传递配置（见 §1.2）
- 自己覆写 `*[Service.init]()` 时**必须** `yield* super[Service.init]()`，否则 Life 绑定丢失

`Cortex` 基类做的事：

```typescript
export abstract class Cortex extends Service {
  static inject = ["life"];

  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }

  *[Service.init]() {
    const unbind = this.ctx.life.bind(this);
    yield unbind;
  }
}
```

### 2.2 形态一：Reactive / Chat —— willingness + 聚合窗口

```typescript
import type {} from "@athena-ai/capability-message";
import { Schema } from "@athena-ai/core";
import { Cortex } from "@athena-ai/protocol";
import type { Session } from "@satorijs/core";
import { Context, Service } from "cordis";

declare module "cordis" {
  interface Context {
    cortex: CortexChat;
  }
}

export interface Config {
  /** 触发阈值：意愿超过此值才回复 */
  threshold: number;
  /** 触发后的聚合窗口（毫秒），窗口内的新消息一并处理 */
  aggregationWindow: number;
}

export const Config: Schema<Config> = Schema.object({
  threshold: Schema.number().default(0.6),
  aggregationWindow: Schema.number().default(3000),
});

export default class CortexChat extends Cortex {
  static name = "cortex-chat";
  static inject = ["life", "message"];
  static Config = Config;

  /** 按 channel 分组的待处理消息 */
  private _pending = new Map<string, Session[]>();
  /** 按 channel 的聚合窗口定时器 */
  private _timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** 正在认知中的 channel —— 防止并发进入同一 channel 的循环 */
  private _busy = new Set<string>();

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "cortex");

    ctx.on("message", (session: Session) => {
      this.ingest(session);
    });
  }

  *[Service.init]() {
    // 复用基类的 Life 绑定
    yield* super[Service.init]();
    // 自己的清理：清空所有定时器
    yield () => {
      for (const timer of this._timers.values()) clearTimeout(timer);
      this._timers.clear();
      this._pending.clear();
    };
  }

  /** Rhythm：事件到达 → 意愿计算 → 超阈值则开聚合窗口 */
  private ingest(session: Session) {
    if (session.userId === session.selfId) return;

    const channelId = session.channelId;
    if (!channelId) return;

    const queue = this._pending.get(channelId) ?? [];
    queue.push(session);
    this._pending.set(channelId, queue);

    if (this.willingness(session) < this.config.threshold) return;
    if (this._timers.has(channelId)) return; // 窗口已开，让它继续聚合

    const timer = setTimeout(() => {
      this._timers.delete(channelId);
      void this.cycle(channelId);
    }, this.config.aggregationWindow);

    this._timers.set(channelId, timer);
  }

  /**
   * 意愿计算：这里放你的产品逻辑（被 @、关键词、关系亲密度、频率抑制……）
   *
   * 注意：Satori v5 的 Session **没有** `stripped` / `appel` —— 那是 Koishi
   * `@koishijs/core` 的加料。原生做法是自己检查 elements 里的 `at` 元素。
   */
  private willingness(session: Session): number {
    const mentioned = (session.elements ?? []).some((el) => el.type === "at" && el.attrs.id === session.selfId);
    return mentioned ? 1 : 0.3;
  }

  /** 一次完整的意识时刻 */
  private async cycle(channelId: string) {
    if (this._busy.has(channelId)) return;
    this._busy.add(channelId);

    try {
      const batch = this._pending.get(channelId) ?? [];
      this._pending.delete(channelId);
      if (!batch.length) return;

      // Integration
      const context = this.integrate(batch);
      // Cognition
      const result = await this.cognize(context);
      // Enactment
      await this.enact(channelId, batch, result);
    } catch (e) {
      this.ctx.logger("cortex-chat").warn(`cycle failed for ${channelId}:`, e);
    } finally {
      this._busy.delete(channelId);
    }
  }

  private integrate(batch: Session[]) {
    return {
      persona: this.ctx.life.persona,
      messages: batch.map((s) => ({
        user: s.author?.name ?? s.userId,
        content: s.content ?? "",
      })),
    };
  }

  private async cognize(context: ReturnType<CortexChat["integrate"]>) {
    // 见 §5 —— AI SDK 调用
    return { text: `...` };
  }

  private async enact(channelId: string, batch: Session[], result: { text: string }) {
    if (!result.text) return; // 「不回复」是一等决策
    await this.ctx.message.createMessage(channelId, result.text, batch.at(-1)?.bot?.sid);
  }
}
```

### 2.3 形态二：Continuous / World —— heartbeat + mailbox

```typescript
export interface Config {
  /** 心跳间隔（毫秒） */
  beatInterval: number;
}

export default class CortexWorld extends Cortex {
  static name = "cortex-world";
  static inject = ["life", "message"];
  // 可选的 minecraft capability 不写进 inject —— 见 §1.3，用 ctx.get() 或 ctx.inject() 子 fiber

  /** 感知邮箱 —— 心跳之间累积，心跳时 drain */
  private _mailbox: Array<{ kind: string; payload: unknown; at: number }> = [];
  private _running = false;

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "cortex");

    // 所有输入源平权地进入同一个 mailbox
    ctx.on("message", (session) => {
      this._mailbox.push({ kind: "message", payload: session, at: Date.now() });
    });

    // 未来：ctx.on("minecraft/block-change", ...) 同样 push 进 mailbox
  }

  *[Service.init]() {
    yield* super[Service.init]();

    this._running = true;
    void this.loop();

    yield () => {
      this._running = false;
      this._mailbox.length = 0;
    };
  }

  /** Rhythm：永不停止的内部心跳，无外部事件也会跳 */
  private async loop() {
    while (this._running) {
      try {
        await this.beat();
      } catch (e) {
        this.ctx.logger("cortex-world").warn("beat failed:", e);
      }
      await new Promise((r) => setTimeout(r, this.config.beatInterval));
    }
  }

  private async beat() {
    // Integration：drain mailbox，包装成世界感知
    const drained = this._mailbox.splice(0, this._mailbox.length);
    const perception = this.wrapAsWorldPerception(drained);

    // Cognition：每拍一次 tool-call
    const action = await this.decideOneAction(perception);

    // Enactment：可能是发消息、可能是世界内动作、也可能什么都不做
    await this.perform(action);
  }

  /** "手机"隐喻：IM 事件不直接消费，而是包装成世界内的感知 */
  private wrapAsWorldPerception(events: Array<{ kind: string; payload: unknown }>) {
    const messages = events.filter((e) => e.kind === "message");
    return {
      time: new Date().toISOString(),
      phoneNotifications: messages.length,
      // 只有当 LLM 决定 check_phone 时才真正读取内容
      pendingMessages: messages,
    };
  }

  private async decideOneAction(perception: unknown) {
    return { type: "wait" as const };
  }

  private async perform(action: { type: string }) {
    // 按 action.type 派发到不同 capability
  }
}
```

### 2.4 形态三：Narrative / Interlude —— debounce + structured output

```typescript
export interface Config {
  /** 静默多久后触发一次叙事轮 */
  debounceMs: number;
  /** 累积多少条刺激后强制触发 */
  maxBuffer: number;
}

export default class CortexInterlude extends Cortex {
  static name = "cortex-interlude";
  static inject = ["life", "message"];

  private _buffer: Session[] = [];
  private _timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "cortex");

    ctx.on("message", (session: Session) => {
      if (session.userId === session.selfId) return;
      this._buffer.push(session);

      if (this._buffer.length >= this.config.maxBuffer) {
        this.fire();
        return;
      }

      // debounce：每条新消息都重置窗口
      if (this._timer) clearTimeout(this._timer);
      this._timer = setTimeout(() => this.fire(), this.config.debounceMs);
    });
  }

  *[Service.init]() {
    yield* super[Service.init]();
    yield () => {
      if (this._timer) clearTimeout(this._timer);
      this._timer = null;
      this._buffer.length = 0;
    };
  }

  private fire() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = null;
    const batch = this._buffer.splice(0, this._buffer.length);
    if (!batch.length) return;
    void this.narrate(batch);
  }

  /** Cognition：单次 structured-output，而非多步 tool-loop */
  private async narrate(batch: Session[]) {
    try {
      // 见 §5.3 —— generateObject
      const turn = await this.generateNarrativeTurn(batch);
      // Enactment：Story-DB 变更 + 发消息
      await this.applyStoryMutation(turn);
      await this.speak(batch, turn);
    } catch (e) {
      this.ctx.logger("cortex-interlude").warn("narrate failed:", e);
    }
  }

  private async generateNarrativeTurn(batch: Session[]): Promise<{ speech: string }> {
    return { speech: "" };
  }

  private async applyStoryMutation(turn: { speech: string }) {}

  private async speak(batch: Session[], turn: { speech: string }) {
    if (!turn.speech) return;
    const last = batch.at(-1)!;
    await this.ctx.message.createMessage(last.channelId!, turn.speech, last.bot?.sid);
  }
}
```

### 2.5 三形态对照

|                  | Reactive / Chat             | Continuous / World           | Narrative / Interlude    |
| ---------------- | --------------------------- | ---------------------------- | ------------------------ |
| 触发             | 事件 + 意愿阈值             | 内部 heartbeat（无事件也跳） | debounce 静默 / 缓冲上限 |
| 缓冲结构         | per-channel 队列 + 聚合窗口 | 全局 mailbox                 | 全局 debounce buffer     |
| 认知             | 有限 tool-loop              | 每拍一次 tool-call，永续     | 单次 structured-output   |
| 「不做」是否合法 | ✅ 意愿不足则沉默           | ✅ `wait` 是正常动作         | ✅ 叙事轮可无对外输出    |
| 清理重点         | 定时器 map                  | 循环开关 + mailbox           | 单个定时器 + buffer      |

### 2.6 发射 Hook 事件【规划中】

Hook 契约尚未在 `@athena-ai/protocol` 中声明。目标形态：

```typescript
// 在 protocol 中声明
declare module "cordis" {
  interface Events {
    // waterfall 是 next() 中间件链：listener 最后一个参数是 next
    "cortex/before-drain"(events: PerceptionEvent[], next: () => PerceptionEvent[]): PerceptionEvent[];
    "cortex/after-integrate"(context: CortexContext, next: () => CortexContext): CortexContext;
    "cortex/before-cognition"(params: CognitionParams, next: () => CognitionParams): CognitionParams;
    // bail：返回真值即短路
    "cortex/before-enact"(actions: CortexAction[]): boolean | void;
    // parallel：纯副作用
    "cortex/after-enact"(results: EnactResult[]): void;
  }
}
```

### waterfall 在 cordis v4 中是中间件链，不是 reduce

这是最容易踩错的一点。`EventsService.waterfall` 的实现：

```typescript
waterfall(...args: any[]) {
  const [thisArg, callbacks] = this._resolve("waterfall", args);
  const inner = args.pop();           // ← 最后一个参数是链尾回调
  const next = () => {
    const callback = callbacks.shift();
    return callback ? Reflect.apply(callback, thisArg, args) : inner(...args);
  };
  args.push(next);                    // ← next 作为最后一个参数传给 listener
  return next();
}
```

因此：

```typescript
// ✅ 正确：最后一个参数是链尾 inner 回调
const filtered = this.ctx.waterfall("cortex/before-drain", drained, (events) => events);

// ❌ 错误：漏掉 inner，最后一个真实参数会被当成 inner 弹出
const filtered = this.ctx.waterfall("cortex/before-drain", drained);
```

插件侧的 listener 必须调用 `next()` 才会继续下游：

```typescript
// 变换：改参数后放行
ctx.on("cortex/before-drain", (events, next) => {
  const cleaned = events.filter((e) => !isSpam(e));
  events.splice(0, events.length, ...cleaned); // 原地改，因为 next 不接收新参数
  return next();
});

// 短路：不调 next，直接返回自己的结果
ctx.on("cortex/before-drain", (events, next) => {
  if (maintenanceMode) return [];
  return next();
});
```

> ⚠️ 注意 `next()` **不接收参数** —— 它复用外层 `args`。要传递修改后的值，必须**原地修改**参数对象，或在 hook 载荷设计上用可变容器。这一点在 Phase 2-B 定型载荷类型时需要明确取舍：要么接受原地修改的约定，要么改用 `bail` + 手工链式调用。

### bail 与 parallel

```typescript
// bail：任一 listener 返回「非 null / 非 false / 非 undefined」即短路
const vetoed = this.ctx.bail("cortex/before-enact", actions);
if (vetoed) return;

// parallel：并发触发副作用；任一 reject 会汇总成 AggregateError 抛出
await this.ctx.parallel("cortex/after-enact", results);
```

`isBailed(value)` 的判定是 `value !== null && value !== false && value !== undefined` —— 注意 `0` 和 `""` **会**短路。

**发射 hook 是可选的**。不发射时，监听这些 hook 的社区插件静默无效 —— 这是设计意图，不是 bug。

---

## 3. 定义一个 Capability Service

Capability 是 Cortex 依赖的抽象契约。以 `capability-message` 为参考实现。

### 3.1 完整参考：MessageService

```typescript
import { Schema } from "@athena-ai/core";
import { Satori, Bot, Session, Dict } from "@satorijs/core";
import type { Fragment } from "@satorijs/element";
import type { Message, SendOptions } from "@satorijs/protocol";
import { Context, Service } from "cordis";

declare module "cordis" {
  interface Context {
    message: MessageService;
  }
}

/**
 * Cordis wraps values passed through event hooks in traced proxies so that
 * `.ctx` follows the receiver. `Symbol.for("cordis.original")` is the proxy's
 * escape hatch back to the underlying object.
 */
const ORIGINAL = Symbol.for("cordis.original");

/** Unwrap a cordis traced proxy, returning the object itself if untraced. */
function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}

export interface Config {}

export default class MessageService extends Service<Config> {
  public static readonly Config: Schema<Config> = Schema.object({});

  private _self: Context;

  constructor(ctx: Context) {
    super(ctx, "message");
    this._self = ctx;

    // 在自己的 context 上安装实现库。
    // 隔离由外层 group entry 声明（isolate: { satori: true }），
    // 这样同 group 的 sibling adapter 能共享这个 domain。
    ctx.plugin(Satori);

    // 事件作用域过滤 —— 见下方 §3.2
    const messageSymbol = ctx[Context.isolate]["message"] as symbol;
    const satoriSymbol = ctx[Context.isolate]["satori"] as symbol;
    ctx.on("internal/session", (session: Session) => {
      const bot = unwrap(session.bot);
      if (!bot || bot.ctx[Context.isolate]["satori"] !== satoriSymbol) return;
      session[Context.filter] = (hookCtx: Context) => {
        return hookCtx[Context.isolate]["message"] === messageSymbol;
      };
    });
  }

  /** 多实例容器 —— 暴露给 Cortex 做寻址 */
  get bots(): Bot[] & Dict<Bot> {
    return this._self.get("satori")?.bots ?? ([] as unknown as Bot[] & Dict<Bot>);
  }

  /** 便捷方法：自动解析 bot */
  async createMessage(channelId: string, content: Fragment, botSid?: string, options?: SendOptions): Promise<Message[]> {
    const bot = this._resolveBot(botSid);
    return bot.createMessage(channelId, content, undefined, options);
  }

  async sendMessage(channelId: string, content: Fragment, botSid?: string, options?: SendOptions): Promise<string[]> {
    const bot = this._resolveBot(botSid);
    return bot.sendMessage(channelId, content, undefined, options);
  }

  async sendPrivateMessage(userId: string, content: Fragment, guildId?: string, botSid?: string, options?: SendOptions): Promise<string[]> {
    const bot = this._resolveBot(botSid);
    return bot.sendPrivateMessage(userId, content, guildId, options);
  }

  /** 寻址：显式指定 → 唯一活跃 → 多义则报错 */
  private _resolveBot(sid?: string): Bot {
    if (sid) {
      const bot = this.bots.find((b) => b.sid === sid);
      if (!bot) throw new Error(`Bot not found: ${sid}`);
      return bot;
    }
    const active = this.bots.filter((b) => b.isActive);
    if (active.length === 0) throw new Error("No active bots available");
    if (active.length === 1) return active[0];
    throw new Error(`Multiple bots available (${active.map((b) => b.sid).join(", ")}); specify botSid`);
  }
}
```

### 3.2 事件作用域过滤模板

任何在内部隔离域中安装实现库、且实现库会广播事件的 Capability，都需要这段：

```typescript
// 1. 捕获自己的 isolate symbol
const mySymbol = ctx[Context.isolate]["<capability-token>"] as symbol;
const implSymbol = ctx[Context.isolate]["<impl-token>"] as symbol;

// 2. 在实现库的「原始事件」上判断归属，并注入 filter
ctx.on("<impl>/internal-event", (payload: SomePayload) => {
  const owner = unwrap(payload.owner);
  // 这个 payload 属于我的 domain 吗？
  if (!owner || owner.ctx[Context.isolate]["<impl-token>"] !== implSymbol) return;
  // 是的话，限定只投递给同 capability isolate 的 hook
  payload[Context.filter] = (hookCtx: Context) => {
    return hookCtx[Context.isolate]["<capability-token>"] === mySymbol;
  };
});
```

**必须 unwrap**：`Session` / `Bot` 声明了 `[Service.tracker] = { property: "ctx" }`，导致 `payload.owner.ctx` 解析为接收方 context。不 unwrap 会让每个实例都认领每个事件。

### 3.3 新建 Capability 的检查清单

- [ ] 定义稳定的 capability token（`'message'` / `'minecraft'` / `'audio'`），并在 [02-architecture.md](./02-architecture.md) §6.1 登记
- [ ] `declare module "cordis"` 增加 `ctx.<token>`
- [ ] 多实例容器（`get instances()` / `get bots()`）
- [ ] 便捷方法处理「唯一实例」情形，多义时报错并列出候选
- [ ] 事件作用域过滤（若实现库广播事件）
- [ ] 保留 `_self` 引用（若需解析 isolate symbol）
- [ ] package.json 的 `cordis.service.implements` 声明
- [ ] **不依赖** `@athena-ai/core` 之外的 athena 包
- [ ] 在 group isolate 清单中加入该 token 与其实现 token

---

## 4. 定义一个 Nerve

Nerve 向 Capability 注册实例。以 `sandbox-nerve` 为参考实现。

### 4.1 参考：SandboxNerve（非 Satori adapter 路径）

```typescript
import { SandboxBot, SELF_ID } from "@athena-ai/plugin-sandbox";
import type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "@athena-ai/protocol";
import { Dict, Universal } from "@satorijs/core";
import type { Context, Fiber } from "cordis";

interface BotHandle {
  fiber: Fiber;
  bot: Promise<SandboxBot>;
}

export default class SandboxNerve {
  public static readonly name = "sandbox-nerve";
  public static readonly inject = ["sandbox", "satori", "life"];

  private _handles: Dict<BotHandle> = Object.create(null);
  private _lifeId: string;

  constructor(private ctx: Context) {
    this._lifeId = ctx.life.persona.name.toLowerCase();

    // 向全局 Hub 注册本 Life 的句柄
    const unregister = (ctx.sandbox as SandboxHubService).register(this._lifeId, {
      meta: {
        name: ctx.life.persona.name,
        description: ctx.life.persona.description,
      },
      dispatch: (payload) => this._dispatch(payload),
      request: (method, data) => this._request(method, data),
      release: (payload) => this._release(payload.platform),
    });

    ctx.effect(() => {
      return () => {
        unregister();
        for (const handle of Object.values(this._handles)) {
          handle.fiber.dispose();
        }
        this._handles = Object.create(null);
      };
    }, "sandbox-nerve.cleanup");
  }

  /** 把外部输入变成 Satori Session 并 dispatch 进本 Life 的事件空间 */
  private async _dispatch(payload: SandboxDispatchPayload): Promise<void> {
    const { platform, user, channel, content, sink } = payload;
    const bot = await this._ensureBot(platform, sink).bot;

    bot.config.sink = sink;

    const id = Math.random().toString(36).slice(2);

    const session = bot.session(this._createEvent(user, channel));
    session.type = "message";
    session.content = content;
    session.messageId = id;
    if (payload.quote) {
      session.quote = { id: payload.quote.id, content: payload.quote.content };
    }
    bot.dispatch(session); // ← 从这里进入 Cordis 事件系统
  }

  /** 懒创建：为每个 platform 在本 Life 的 satori domain 中装一个 Bot */
  private _ensureBot(platform: string, sink: MessageSink): BotHandle {
    const existing = this._handles[platform];
    if (existing) return existing;

    const ctx = this.ctx;
    const fiber = ctx.plugin(SandboxBot, {
      platform,
      selfId: SELF_ID,
      selfName: ctx.life.persona.name,
      sink,
      fileBase: (ctx.sandbox as SandboxHubService).fileBase,
    });

    const bot = (async () => {
      await fiber;
      const registered = ctx.satori.bots[`${platform}:${SELF_ID}`];
      if (!registered) {
        throw new Error(`sandbox-nerve: bot was not registered for platform ${platform}`);
      }
      return registered as SandboxBot;
    })();

    return (this._handles[platform] = { fiber, bot });
  }

  private async _release(platform: string): Promise<void> {
    const handle = this._handles[platform];
    if (!handle) return;
    delete this._handles[platform];
    await handle.fiber.dispose();
  }

  private _createEvent(userId: string, channelId: string): Partial<Universal.Event> {
    const isDirect = channelId === "@" + userId;
    return {
      user: { id: userId, name: userId },
      channel: {
        id: channelId,
        type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
      },
      guild: isDirect ? undefined : { id: channelId },
      timestamp: Date.now(),
    };
  }
}
```

### 4.2 IM Nerve = Satori Adapter

对标准 IM 平台，Nerve 就是普通的 Satori adapter，作为 group 内的 sibling entry 安装：

```yaml
- name: "@cordisjs/plugin-group"
  label: Alice
  isolate: { life: true, cortex: true, message: true, satori: true }
  config:
    - name: "@athena-ai/plugin-life"
      config: { persona: { name: Alice, description: "...", traits: {} } }
    - name: "@athena-ai/capability-message" # 提供 satori domain
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/adapter-onebot" # ← Nerve，inject: ['satori']
      config: { selfId: "123", endpoint: "ws://localhost:6700", protocol: ws }
```

Adapter 侧只需 `inject: ["satori"]` 并把 Bot 注册进 `ctx.satori.bots`。**注意 `ctx.bots` 在 Athena 中不存在**（vendored Satori 已移除 mixin），一律用 `ctx.satori.bots`。

### 4.3 Hub + Nerve 分离模式

当一个能力既有**全局唯一的资源**（WebUI 页面、HTTP 路由、单例连接池），又有**per-Life 的状态**（bot 实例、会话）时，拆成两半：

```
Root Context
└── XxxHub（provides 'xxx'，inject: ['webui'] 等全局设施）
      ├── 注册全局路由/监听器（一次）
      ├── registry: Map<lifeId, XxxNerveHandle>
      └── 按 lifeId 路由到对应 Nerve

Life Group
└── XxxNerve（inject: ['xxx', <impl-token>, 'life']）
      ├── 向 Hub 注册自己的 handle
      └── 在本地 domain 创建实例
```

要点：

- Hub 的 token **不**加入 group 的 isolate 清单（它是全局的）
- 所有 wire frame 携带 `lifeId` 字段做多路复用
- Hub 通过 payload 传入 sink/callback，避免 Nerve 依赖 Hub 的传输细节
- Nerve 的 `register()` 返回 disposer，在 `ctx.effect()` 中清理

### 4.4 新建 Nerve 的检查清单

- [ ] `static inject` 包含目标 capability 的 impl token（如 `"satori"`）
- [ ] 需要 Life 身份时 inject `"life"`
- [ ] 平台连接、认证、重连在 Nerve 内部处理
- [ ] 实例注册进 capability 容器，**不**直接暴露给 Cortex
- [ ] 事件通过 capability 的机制发射（IM 用 `bot.dispatch(session)`）
- [ ] 清理逻辑注册在 `ctx.effect()` 或 `*[Service.init]()` 中
- [ ] **不**提供 service（Nerve 通常不 provide，除非是 Hub）

---

## 5. 使用 AI SDK v7

> ⚠️ **当前状态**：`ctx.ai`（`AIService`）已可用；`cortex-chat` 尚未集成 AI SDK（见 [06](./06-progress-and-roadmap.md) §4 Phase 2-C）。
>
> 本节代码已针对 `ai@7.0.70` + `zod@3.25.76` 用 `tsc` 实测通过。

### 5.1 通过 AIService 解析模型

`ctx.ai` 返回的都是 **AI SDK 原生类型**，直接交给 `streamText` / `generateText` / `embed`：

```typescript
// 完整 id
const model = this.ctx.ai.language("deepseek:deepseek-chat"); // → LanguageModelV4

// models.yml 里的 alias
const fast = this.ctx.ai.language("fast");

// 省略参数 → models.yml 的 defaults.language
const preferred = this.ctx.ai.language();

// 其他模态
const embedder = this.ctx.ai.embedding(); // → EmbeddingModelV4
const tts = this.ctx.ai.speech("openai:tts-1"); // → SpeechModelV4

// 元数据用于决策（是否支持 vision / tool call / 上下文长度）
const meta = this.ctx.ai.metadata("deepseek:deepseek-chat");
if (meta?.toolCall !== false) {
  /* 装配 tools */
}
```

返回的模型已经把 `models.yml` 中声明的 per-provider / per-model 默认参数用 AI SDK 的 `defaultSettingsMiddleware` 包好了。**调用时显式传的参数永远赢**，所以不必担心默认值盖掉本次调用的意图。

#### failover：循环归 Cortex，框架只给候选

```typescript
// config.model 可以是 "openai:gpt-4o" / "fast"（alias）/ "main"（group）
const candidates = this.ctx.ai.candidates(this.config.model);

for (const candidate of candidates) {
  try {
    const response = streamText({
      model: candidate.model,
      messages,
      tools,
      stopWhen: [stepCountIs(10)],
      maxRetries: 0, // 重试由这个循环负责，别让 SDK 再叠一层
      abortSignal,
    });
    for await (const part of response.fullStream) {
      // 消费 stream...
    }
    candidate.success();
    return response;
  } catch (e) {
    candidate.failure(); // 喂 group 的断路器
    this.ctx.logger("cortex-chat").warn(`Model ${candidate.id} failed:`, e);
  }
}

throw new Error("All models exhausted");
```

用元数据裁剪候选：

```typescript
const hasImage = messages.some((m) => /* ... */);
const usable = hasImage ? candidates.filter((c) => c.metadata.modalities?.input?.includes("image")) : candidates;
```

断路器状态可观测（运维 / WebUI）：

```typescript
const group = this.ctx.ai.group("main");
group.status(); // Map<"openai:gpt-4o", { state: "open", failures: 3 }>
group.reset("openai:gpt-4o"); // 手动闭合
```

### 5.2 多步 tool-loop（Reactive / World Cortex）

```typescript
import { generateText, stepCountIs, tool } from "ai";
import { z } from "zod";

private async cognize(context: IntegratedContext) {
  const model = this.ctx.ai.language(this.config.model);

  const result = await generateText({
    model,
    system: this.buildSystemPrompt(context.persona),
    messages: this.buildMessages(context),
    tools: {
      ...this.layer2Tools(),          // Cortex 定义的产品语义 tool
      // ...this.ctx.tools.available(),  // 【规划中】Layer 3 插件 tool
      // provider 内建 tool（web search 等）目前不经过 ctx.ai，见 §5.6 的已知缺口
    },
    stopWhen: stepCountIs(8),         // ← 不是 maxSteps
    abortSignal: this.abortSignal,
  });

  return { text: result.text, steps: result.steps };
}

/** Layer 2：产品语义工具 —— LLM 看到的是「角色说话」，不是「调 IM API」 */
private layer2Tools() {
  return {
    send_message: tool({
      description: "Say something in a channel. Omit to stay silent.",
      inputSchema: z.object({
        channelId: z.string().describe("Target channel id"),
        content: z.string().describe("What to say"),
        botSid: z.string().optional().describe("platform:selfId; omit when unambiguous"),
      }),
      // ⚠️ 用单个 `input` 参数，不要解构 —— 见下方「类型推导陷阱」
      execute: async (input) => {
        const ids = await this.ctx.message.sendMessage(input.channelId, input.content, input.botSid);
        return { messageIds: ids };
      },
    }),

    wait: tool({
      description: "Do nothing this turn and let time pass.",
      inputSchema: z.object({
        reason: z.string().describe("Why waiting is the right choice"),
      }),
      execute: async (input) => ({ waited: true, reason: input.reason }),
    }),
  };
}
```

**关键约定**（D-14 / D-15）：

- Tool 接收**完整寻址信息**作为 LLM 提供的参数（`channelId`、`botSid`），框架**不注入** context
- Tool 通过闭包中的 `this.ctx` 访问 service —— service 是活引用，无需捕获具体实例
- `abortSignal` 由 AI SDK 原生提供（`ToolExecutionOptions.abortSignal`），无需框架注入
- Tool 是「薄函数」：把 LLM 参数翻译成 service 调用
- 多步循环用 **`stopWhen: stepCountIs(n)`** —— `ai@7` 已**没有** `maxSteps`

#### ⚠️ 类型推导陷阱：不要解构 `execute` 的参数

当 `inputSchema` 含**可选字段**、且该字段被转发进一个带**可选参数**的函数时，解构写法会让 TS 无法推导 `tool()` 的 `INPUT` 泛型，报出令人困惑的：

```
error TS2769: No overload matches this call.
  Type 'ZodObject<...>' is not assignable to type 'FlexibleSchema<never>'.
```

```typescript
// ❌ 解构 + 转发可选字段 → 推导失败
execute: async ({ channelId, content, botSid }) => {
  return this.ctx.message.sendMessage(channelId, content, botSid);
}

// ✅ 单个 input 参数
execute: async (input) => {
  return this.ctx.message.sendMessage(input.channelId, input.content, input.botSid);
}

// ✅ 或解构但显式标注参数类型
const schema = z.object({ channelId: z.string(), botSid: z.string().optional() });
execute: async ({ channelId, botSid }: z.infer<typeof schema>) => { ... }
```

把 tool 提取成 `const` 变量**不能**解决这个问题 —— 只有上面两种写法可靠。**统一用 `input` 形式**。

### 5.3 单次结构化输出（Narrative Cortex）

```typescript
import { generateObject } from "ai";
import { z } from "zod";

private async generateNarrativeTurn(batch: Session[]) {
  const model = this.ctx.ai.language(this.config.model);

  const { object } = await generateObject({
    model,
    schema: z.object({
      innerThought: z.string().describe("What the character is thinking"),
      speech: z.string().describe("What the character says out loud; empty to stay silent"),
      stateChanges: z.array(z.object({
        key: z.string(),
        value: z.string(),
      })).describe("Mutations to apply to the story database"),
    }),
    system: this.buildNarratorPrompt(),
    prompt: this.renderStimuli(batch),
  });

  return object;
}
```

### 5.4 流式输出

```typescript
import { streamText } from "ai";

const model = this.ctx.ai.language(this.config.model);
const result = streamText({ model, messages, tools });

let buffer = "";
for await (const delta of result.textStream) {
  buffer += delta;
  // 可在此做分句、逐段发送等产品逻辑
}

// 这些是 PromiseLike，需要 await
const finishReason = await result.finishReason;
const usage = await result.usage;
```

### 5.5 新建一个 Provider 插件

Provider 插件是**最薄的一类插件**：创建 AI SDK client，注册，完事。模型声明、元数据、headers、默认参数全在 `models.yml`，插件不知道它存在。

```typescript
// plugins/provider-deepseek/src/index.ts
import type {} from "@athena-ai/ai"; // 拉进 ctx.ai 的类型增强
import { createDeepSeek } from "@ai-sdk/deepseek";
import { Schema } from "@athena-ai/core";
import type { Context } from "cordis";

export const name = "provider-deepseek";

export const inject = ["ai"];

/** 同一个包允许多次安装（官方 key + 内部网关），靠 config.id 区分 */
export const reusable = true;

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek").description("提供商标识（不可与已注册的提供商重复）"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("自定义 API 地址，留空使用官方端点"),
});

export function apply(ctx: Context, config: Config) {
  const provider = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-deepseek(${config.id}).unregister`);
}
```

`package.json` 里声明 `cordis.service.required: ["ai"]`，依赖里放 `@ai-sdk/<name>` + `zod`（AI SDK 的 peer）。

检查清单：

- [ ] `export const reusable = true`
- [ ] `Config` 只有 `id` / `apiKey` / `baseURL` —— 别把模型列表搬回前端表单（D-34）
- [ ] `apiKey` 用 `.role("secret")`
- [ ] disposer 交给 `ctx.effect()`，不要自己挂 `ctx.on("dispose")`
- [ ] `id` 重复时 `register()` 会 `logger.error` + 抛错，让 fiber 失败并在 WebUI 显示为错误状态 —— 这是刻意的，不要 catch 掉

### 5.6 三层工具的组装位置

```
generateText({
  tools: {
    ...cortex.layer2Tools(),        // Layer 2：Cortex 定义，产品语义
    ...ctx.tools.available(),       // Layer 3：插件贡献，平台透传【规划中】
  }
})
```

Layer 1（结构化能力，如 `ctx.message.createMessage`）**不**进 tool 集合 —— 它由 Cortex 代码程序化调用，是 Layer 2 tool 的实现手段。

> **已知缺口**：provider 内建 tool（`client.tools.webSearch()` 之类）目前**不经过** `ctx.ai` —— `register()` 只收 `ProviderV4`，而内建 tool 挂在各家 client 的自有字段上，不属于 `ProviderV4` 契约。需要时由 Cortex 自己 `createOpenAI()` 取，或等后续为此设计入口。

### 5.7 `models.yml` 速查

模型知识集中在这一个文件里（**不进** WebUI 表单，D-34）：

```yaml
defaults: # 各模态的默认模型，快捷方法省略参数时用
  language: deepseek:deepseek-chat
  embedding: openai:text-embedding-3-small

aliases: # 短名 → provider:model
  fast: openai:gpt-4o-mini
  smart: anthropic:claude-sonnet-4-5

strict: false # true = 只允许已声明的模型 resolve

providers:
  openai: # ← key 必须与 provider 插件 config.id 一致
    options:
      headers: { X-Org: athena } # per-provider transport
    defaults:
      maxOutputTokens: 4096 # per-provider 调用默认值，该 provider 下所有模型继承
    models:
      - id: gpt-4o
        type: language # 省略则默认 language
        metadata:
          toolCall: true
          reasoning: true
          modalities: { input: [text, image], output: [text] }
          limit: { context: 128000, output: 16384 }
        defaults: # per-model，覆盖 per-provider
          temperature: 0.7
          providerOptions:
            openai: { reasoningEffort: high }
      - id: text-embedding-3-small
        type: embedding

groups: # 仅 language model
  main:
    strategy: failover # failover | round-robin | random
    models: [deepseek:deepseek-chat, openai:gpt-4o] # 成员可以是 alias
    circuitBreaker:
      failureThreshold: 3 # 连续失败次数后开断路器
      recoveryTimeout: 60 # 秒；之后进 half-open 放一次探测
```

几个容易踩的点：

- `defaults` 里的键必须是 **AI SDK 的 call setting 名**（`maxOutputTokens`，不是 `maxTokens`）。写错会被丢掉并 warn，不会静默生效
- 隐式的 `./models.yml` 缺失只 warn（空注册表照样启动）；**显式**配了 `configPath` 却找不到文件 → 抛错
- YAML 解析失败、根节点不是 mapping → 抛错。单条目格式错 → warn + 跳过
- alias 的目标必须含 `:`，group 不能嵌套 group

---

## 6. Multi-Life 部署配置

### 6.1 `cordis.yml`（bootstrap / prelude）

```yaml
- name: "@cordisjs/plugin-cli"
  config:
    name: athena
- name: "@cordisjs/plugin-cli-cordis"
  config:
    path: ./app.yml
    daemon:
      enabled: true
    prelude:
      - name: "@cordisjs/plugin-env"
      - name: "@cordisjs/plugin-logger-console"
      - name: "@athena-ai/core"
```

### 6.2 `app.yml`（managed plugin tree）

```yaml
# ── 全局基础设施（所有 Life 之外）──
- name: "@cordisjs/plugin-webui"
- name: "@cordisjs/plugin-server"
- name: "@cordisjs/plugin-hmr"
  config:
    root: [packages, plugins, instances]
- name: "@cordisjs/plugin-database-sqlite"
  config:
    path: ./data/athena.db

# ── 全局 Hub（provides 'sandbox'，不进 group）──
- name: "@athena-ai/plugin-sandbox"

# ── Alice ──
- name: "@cordisjs/plugin-group"
  label: Alice
  isolate:
    life: true
    cortex: true
    message: true
    satori: true
  config:
    - name: "@athena-ai/plugin-life"
      config:
        persona:
          name: Alice
          description: A curious and friendly digital life.
          traits:
            personality: curious, friendly, helpful
    - name: "@athena-ai/capability-message"
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/sandbox-nerve"
    - name: "@athena-ai/adapter-onebot"
      config:
        selfId: "123"
        endpoint: "ws://localhost:6700"
        protocol: ws

# ── Bob ──
- name: "@cordisjs/plugin-group"
  label: Bob
  isolate:
    life: true
    cortex: true
    message: true
    satori: true
  config:
    - name: "@athena-ai/plugin-life"
      config:
        persona:
          name: Bob
          description: A thoughtful digital philosopher.
          traits:
            personality: contemplative
    - name: "@athena-ai/capability-message"
    - name: "@athena-ai/cortex-chat"
    - name: "@athena-ai/sandbox-nerve"
    - name: "@athena-ai/adapter-onebot"
      config:
        selfId: "456"
        endpoint: "ws://localhost:6701"
        protocol: ws
```

### 6.3 用 `plugin-include` 抽出 Instance【规划中】

```yaml
# app.yml
- name: "@cordisjs/plugin-group"
  label: Alice
  isolate: { life: true, cortex: true, message: true, satori: true }
  config:
    - name: "@cordisjs/plugin-include"
      config:
        path: ./instances/alice.yml
```

```yaml
# instances/alice.yml
- name: "@athena-ai/plugin-life"
  config:
    persona: ./personas/alice-persona.yml # ← 文件加载尚未实现
    memory:
      backend: sqlite
      path: ./data/alice.db
- name: "@athena-ai/capability-message"
- name: "@athena-ai/cortex-chat"
  config:
    model: deepseek:deepseek-chat
- name: "@athena-ai/sandbox-nerve"
```

### 6.4 isolate 清单速查

| Token                           | 是否隔离 | 原因                                                   |
| ------------------------------- | -------- | ------------------------------------------------------ |
| `life`                          | ✅       | 每 Life 独立的 persona / memory / cortex 绑定          |
| `cortex`                        | ✅       | 否则第二个 `provide('cortex')` 冲突                    |
| `message`                       | ✅       | 否则 MessageService 冲突 + 事件过滤失效                |
| `satori`                        | ✅       | 否则 `provide('satori')` 冲突；adapter 无法区分 domain |
| `sandbox`                       | ❌       | Hub 是全局的，Nerve 从 root inject                     |
| `webui` / `server` / `database` | ❌       | 共享基础设施                                           |
| 未来 `minecraft` / `audio`      | ✅       | 与 `message` 同理                                      |

---

## 7. 测试模式

### 7.1 Service 安装与依赖

```typescript
import MessageService from "@athena-ai/capability-message";
import { Life } from "@athena-ai/plugin-life";
import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import CortexChat from "../src/index";

describe("CortexChat", () => {
  it("activates when both life and message are available", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(MessageService, {});
    await ctx.plugin(CortexChat);
    expect(ctx.cortex).toBeInstanceOf(CortexChat);
  });

  it("does not activate without message service", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    // 不要 await —— 'message' inject 未满足，fiber 停在 PENDING
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("binds as the active cortex in Life", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(MessageService, {});
    await ctx.plugin(CortexChat);
    expect(Reflect.get(ctx.life, "_cortex")).toBeInstanceOf(CortexChat);
  });
});
```

### 7.2 契约边界（抛错路径）

```typescript
it("bind throws on second cortex", async () => {
  const ctx = new Context();
  await ctx.plugin(Life, {
    persona: { name: "Alice", description: "Test", traits: {} },
  });
  const cortex1 = { name: "cortex-1" } as unknown as Service;
  const cortex2 = { name: "cortex-2" } as unknown as Service;
  ctx.life.bind(cortex1);
  expect(() => ctx.life.bind(cortex2)).toThrow("Only one Cortex per Life");
});

it("bind returns disposer that clears reference", async () => {
  const ctx = new Context();
  await ctx.plugin(Life, {
    persona: { name: "Alice", description: "Test", traits: {} },
  });
  const cortex = { name: "test-cortex" } as unknown as Service;
  const unbind = ctx.life.bind(cortex);
  unbind();
  expect(getCortex(ctx.life)).toBeNull();
});

it("disposer ignores if already rebound", async () => {
  // 热重载场景：旧 disposer 不该清掉新绑定
  const unbind1 = ctx.life.bind(cortex1);
  unbind1();
  ctx.life.bind(cortex2);
  unbind1(); // 无效果
  expect(getCortex(ctx.life)).toBe(cortex2);
});
```

### 7.3 访问私有状态

```typescript
function getCortex(life: Life): Service | null {
  return Reflect.get(life, "_cortex") as Service | null;
}
```

### 7.4 隔离域与 StubBot

```typescript
import { Bot, type Session, Universal } from "@satorijs/core";
import { Context } from "cordis";

/** 构造运行时的真实布局：group 拥有隔离 */
function createDomain() {
  const ctx = new Context();
  const inner = ctx.isolate("satori").isolate("bots");
  return { ctx, inner };
}

/** 最小的真实 Bot，使 session.bot.ctx 反映真实 domain */
class StubBot extends Bot<{ platform: string }> {
  static reusable = true;
  static inject = ["satori"];

  constructor(ctx: Context, config: { platform: string }) {
    super(ctx, config);
    this.selfId = "self";
    this.platform = config.platform;
  }

  async connect() {
    this.online();
  }
}

/** 在 domain 中装一个 bot 并让它 dispatch 一条消息 */
async function dispatch(domain: Context, platform: string): Promise<Session> {
  await domain.plugin(StubBot, { platform });
  const bot = domain.satori.bots[`${platform}:self`];
  const session = bot.session({
    user: { id: "u1", name: "u1" },
    channel: { id: "c1", type: Universal.Channel.Type.TEXT },
    timestamp: Date.now(),
  });
  session.type = "message";
  session.content = "hello";
  session.messageId = "m1";
  bot.dispatch(session);
  return session;
}
```

用它验证跨 domain 不串台：

```typescript
it("claims a session dispatched by a bot in its own satori domain", async () => {
  const { inner } = createDomain();
  await inner.plugin(MessageService, {});
  const session = await dispatch(inner, "test");
  expect(session[Context.filter]).toBeDefined();
});

it("ignores a session dispatched by a bot from another satori domain", async () => {
  // 两个独立 domain，各装一个 MessageService，断言互不认领
});
```

### 7.5 Fake 外部世界

```typescript
/** 代表一个持有 WebUI socket 的浏览器标签 */
class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];

  send(payload: Frame) {
    this.frames.push(payload);
  }

  last(type: string): Frame | undefined {
    return this.frames.filter((frame) => frame.type === type).at(-1);
  }
}

/** 最小 WebUI mock */
class FakeWebUI {
  readonly listeners: Dict<(body?: unknown) => unknown> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);
  addEntry() {
    return {};
  }
}
```

原则：**Cordis 与 Satori 用真的，外部世界（浏览器、HTTP、平台）用 fake。**

### 7.6 跨包引用：相对路径指向 src

`vitest.config.ts` **没有配 alias**。测试直接用相对路径引 src，跨包也一样：

```typescript
// plugins/sandbox-nerve/tests/nerve.spec.ts
import SandboxHub from "../../sandbox/src/index";
import SandboxNerve from "../src/index";

// plugins/provider-openai/tests/provider.spec.ts
import { AIService } from "../../../packages/ai/src/index";
import * as ProviderOpenAI from "../src/index";
```

这样测的永远是源码，不依赖 `lib/` 是否构建过。新增包**不需要**改 `vitest.config.ts`。

> 注意：插件源码里的 `import type {} from "@athena-ai/ai"` 走的是 `lib/index.d.ts`（包名解析）。它只是类型增强，vitest 下会被 esbuild 整行擦掉，所以运行时不需要构建产物；但**编辑器里**若同时看到 `src` 与 `lib` 两份 `AIService` 声明，可能报重复属性 —— `tests/` 不在任何 `tsconfig.json` 的 `include` 里，`yarn build` 不会因此失败。

---

## 8. 常用工具片段

### 8.1 穿透 cordis traced proxy

```typescript
const ORIGINAL = Symbol.for("cordis.original");

function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}
```

用于任何需要读取对象**真实归属 context** 的场合。

### 8.2 按 name 比较 service（而非 identity）

```typescript
bind(cortex: Service): () => void {
  if (this._cortex) {
    throw new Error(
      `Only one Cortex per Life. Current: ${this._cortex.name}, attempted: ${cortex.name}`,
    );
  }
  this._cortex = cortex;
  const name = cortex.name;               // ← 捕获稳定标识
  return () => {
    if (this._cortex && this._cortex.name === name) {
      this._cortex = null;
    }
  };
}
```

Cordis 用 Proxy 包装 service 做 context 重绑定，`serviceA === serviceB` 可能为 `false`。**存引用时按 `.name` 比较。**

### 8.3 读取 isolate symbol

```typescript
const messageSymbol = ctx[Context.isolate]["message"] as symbol;
const satoriSymbol = ctx[Context.isolate]["satori"] as symbol;
```

### 8.4 无原型字典

```typescript
private _handles: Dict<BotHandle> = Object.create(null);
```

用 `Object.create(null)` 避免 `__proto__` 等原型键污染（存放来自外部的字符串键时尤其重要）。

### 8.5 安全获取可选 service

```typescript
const satori = this._self.get("satori");
if (!satori) return [];
return satori.bots;

// 或链式
return this._self.get("satori")?.bots ?? [];
```

### 8.6 懒创建 + Promise 缓存

```typescript
interface BotHandle {
  fiber: Fiber;
  bot: Promise<SandboxBot>;
}

private _ensureBot(platform: string, sink: MessageSink): BotHandle {
  const existing = this._handles[platform];
  if (existing) return existing;

  const fiber = this.ctx.plugin(SandboxBot, { platform, /* ... */ });

  const bot = (async () => {
    await fiber;                                     // 等 fiber 激活
    const registered = this.ctx.satori.bots[`${platform}:${SELF_ID}`];
    if (!registered) throw new Error(`bot was not registered for ${platform}`);
    return registered as SandboxBot;
  })();

  return (this._handles[platform] = { fiber, bot });
}
```

`ctx.plugin()` 返回 `Fiber`，可 await 等其激活完成。

### 8.7 构造 Satori Session 并注入事件空间

```typescript
const session = bot.session({
  user: { id: userId, name: userId },
  channel: {
    id: channelId,
    type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
  },
  guild: isDirect ? undefined : { id: channelId },
  timestamp: Date.now(),
});
session.type = "message";
session.content = content;
session.messageId = id;
bot.dispatch(session);
```

### 8.8 富文本内容

```typescript
import { h } from "@satorijs/element";

// 纯文本
await ctx.message.createMessage(channelId, "hello");

// 图片
await ctx.message.createMessage(channelId, h("img", { src: "https://..." }));

// 混合
await ctx.message.createMessage(channelId, [h("quote", { id: session.messageId }), h("at", { id: session.userId }), " 你好"]);
```

### 8.9 Cortex 中的串行化保护

Push-based 事件没有天然串行保证，Cortex 自己负责：

```typescript
private _busy = new Set<string>();

private async cycle(channelId: string) {
  if (this._busy.has(channelId)) return;   // 或改为排队
  this._busy.add(channelId);
  try {
    // ...
  } finally {
    this._busy.delete(channelId);
  }
}
```
