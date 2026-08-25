# 代码规范

> 本文是**必读**。所有贡献（人类或 AI agent）都需遵守。模板代码见 [04-patterns-and-recipes.md](./04-patterns-and-recipes.md)。

---

## 1. TypeScript 约定

### 1.1 编译配置

根 `tsconfig.base.json`：

```json
{
  "compilerOptions": {
    "target": "es2024",
    "module": "esnext",
    "moduleResolution": "bundler",
    "declaration": true,
    "emitDeclarationOnly": true,
    "composite": true,
    "incremental": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "strict": true,
    "noImplicitAny": false,
    "types": ["node"]
  }
}
```

要点：

- **纯 ESM** —— 所有 package.json 都有 `"type": "module"`
- **`strict: true`，但 `noImplicitAny: false`** —— 允许隐式 any（与 Satori/Cordis 生态的动态特性妥协），但其他 strict 检查全开
- **`emitDeclarationOnly`** —— tsc 只出 `.d.ts`，JS 由 esbuild 产出
- **`moduleResolution: "bundler"`** + `allowImportingTsExtensions` —— import 时支持 `.ts` / `.js` 扩展名

### 1.2 Import 规范

**扩展名**：**新代码必须添加扩展名**。src 内源文件使用 `.js` 后缀（`moduleResolution: "bundler"` + esbuild 产出 JS 时路径一致）；跨包 import 使用相对路径直接导入源文件，不配置 `resolve.alias`：

```typescript
// ✅ 推荐（新代码）
import { Life } from "./life.js";
import { Cortex } from "@athena-ai/protocol";

// ✅ 跨包测试 import（相对路径直接到源文件）
import { AIService } from "../../../packages/ai/src/index.js";

// ⚠️ 存量代码中省略扩展名的写法，逐步回改
import { Cortex } from "./cortex";
```

**Import 排序**由 oxfmt 自动处理，分组顺序：

1. `type-import`（纯类型导入）
2. `value-builtin` + `value-external`（Node 内置 + 外部包）
3. `type-internal`
4. `value-internal`
5. `type-parent` / `type-sibling` / `type-index`
6. `value-parent` / `value-sibling` / `value-index`
7. `unknown`

不要手动排序 —— 跑 `yarn format` 即可。

**类型增强导入**：为了拿到某个包的 `declare module "cordis"` 类型增强，用空的 type-only import：

```typescript
import type {} from "@athena-ai/protocol-im"; // 引入 IM 事件/方法类型增强
import type {} from "@cordisjs/plugin-server"; // 引入 server 相关类型
```

### 1.3 禁用与偏好

| 禁止                         | 用什么代替                 |
| ---------------------------- | -------------------------- |
| `enum`                       | `as const` 对象 + 联合类型 |
| `namespace` 作为模块组织手段 | ESM export                 |
| `require()` / CommonJS       | ESM `import`               |
| `any` 作为图省事的逃逸       | `unknown` + 类型收窄       |
| 默认导出匿名函数/类          | 命名后再默认导出           |

**允许并鼓励**的 `namespace` 用法：与类同名的 namespace 承载配置类型，这是 cordis/koishi 生态惯例：

```typescript
export class Life extends Service implements LifeService {
  constructor(ctx: Context, public config: Life.Config) { ... }
}

export namespace Life {
  export interface Config {
    persona: string | Persona;
  }
}
```

---

## 2. Tooling

| 命令                                | 作用                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| `yarn build`                        | yakumo pipeline：tsc（`.d.ts`）→ esbuild（JS）→ client（WebUI 资源） |
| `yarn clean`                        | 清理构建产物                                                         |
| `yarn test`                         | Vitest（经 yakumo-vitest）                                           |
| `yarn lint` / `yarn lint:fix`       | oxlint                                                               |
| `yarn format` / `yarn format:check` | oxfmt                                                                |

### 类型安全 lint（anti-slop）

`yarn lint` 使用根目录 `oxlint.config.ts` 注册的 `anti-slop` 规则集，重点约束运行时边界和类型逃逸：

- 不要用 `any`、`unknown` 作为业务参数/返回值或字典值；为 JSON、YAML、memory、transport 等边界定义命名域类型。
- 不要使用 `x as unknown as T` 链式断言；优先使用类型谓词、`instanceof`、显式分支或泛型收窄。
- 必要的框架/DOM/第三方库边界断言，必须在所在语句前写 `SAFETY:` 注释，说明实际不变量，而不是重复断言本身。
- 不要用 `Reflect.get` / `Reflect.apply` 窥探私有实现；优先公开的类型化 API 或 `Function.call`。
- `typeof` 只用于真实运行时类型谓词；配置/YAML 解码统一先进入命名域类型，再由类型谓词收窄。

新增或修改代码后至少执行 `yarn lint`；自定义规则的测试位于 `tools/oxlint/anti-slop/`，由 oxlint plugin 测试环境驱动，不属于 Vitest 项目测试。

### 2.1 格式化规则（oxfmt）

| 设置                 | 值                                   |
| -------------------- | ------------------------------------ |
| `printWidth`         | **160**                              |
| `semi`               | `true`（必须分号）                   |
| `singleQuote`        | `false`（**双引号**）                |
| `trailingComma`      | `"all"`                              |
| `endOfLine`          | `lf`                                 |
| `objectWrap`         | `preserve`（保留你写的对象换行形态） |
| `insertFinalNewline` | `true`                               |

忽略路径：`lib`、`dist`、`node_modules`、`.specify`、`.omp`、`.agents`、**`vendor`**。

> **不要手工调格式。** 提交前跑 `yarn format`，或依赖 pre-commit hook。

### 2.2 Pre-commit hook

husky + lint-staged 已配置：

```json
"lint-staged": {
  "*.{ts,tsx,mjs,cjs,js,jsx}": ["oxlint --fix", "oxfmt --write"],
  "*.json": ["oxfmt --write"]
}
```

`package.json` 的依赖字段与 scripts 会被 oxfmt 自动排序（`sortDependencies` / `sortDevDependencies` / `sortPeerDependencies` / `sortScripts`）—— 手写顺序不重要。

### 2.3 修改 vendored 代码

`vendor/` 被 oxfmt 忽略，保持上游格式。修改 vendored 代码时：

1. 改动尽可能小、局部
2. 在 [05-lessons-learned.md](./05-lessons-learned.md) 与 `.specify/specs/` 中记录改动与理由
3. 在 [02-architecture.md](./02-architecture.md) §11.3 的表格中登记

---

## 3. Service 定义规范

### 3.1 基本形态

```typescript
import { Context, Service } from "cordis";

declare module "cordis" {
  interface Context {
    myService: MyService;
  }
}

export interface Config {
  option?: string;
}

export default class MyService extends Service<Config> {
  public static readonly Config: Schema<Config> = Schema.object({
    option: Schema.string(),
  });

  static inject = ["dependency"];

  constructor(
    ctx: Context,
    public config: Config, // ← 必须自己声明；基类不提供 this.config
  ) {
    super(ctx, "myService"); // ← 第二参数 = provide key
  }
}
```

> ⚠️ **cordis v4 的 `Service<T>` 基类不提供 `this.config`。** 它只声明 `[Service.config]: T` 类型标记，用于 `intercept` 的配置推导。想访问配置**必须**在构造函数里写 `public config: Config`。仓库中 `Life`（`plugins/life/src/life.ts:27-28`）与 `SandboxHub`（`plugins/sandbox/src/index.ts:91-92`）都是这个写法。不需要读配置的 Service 可以只写 `constructor(ctx: Context)`。

### 3.2 provide key

两种等价写法，仓库中统一用 **constructor 传参**：

```typescript
// ✅ 仓库风格
constructor(ctx: Context) {
  super(ctx, "message");
}

// 也合法，但仓库不用
static [Service.key] = "message";
```

provide key 必须与 `declare module "cordis"` 中的属性名一致。

### 3.3 依赖声明

```typescript
static inject = ["life", "message"];        // 全部必需 —— 缺一个则 fiber 停在 PENDING
```

**cordis v4 没有 `static optional`。** `Plugin.Base` 只有 `inject` / `provide` / `intercept`，`Inject.resolve()` 把数组项一律映射为必需项。表达可选依赖有两种方式：

```typescript
// 方式 A：ctx.get() —— 不可用时返回 undefined，不抛错
const minecraft = this.ctx.get("minecraft");
if (minecraft) await minecraft.doSomething();

// 方式 B：嵌套 inject 子 fiber —— 依赖可用时才激活，可用性变化时自动重载
ctx.inject(["minecraft"], (scoped) => {
  scoped.on("minecraft/block-change", handler);
});
```

注意：直接 `ctx.minecraft`（未 inject 且未 provide）会抛 `cannot get property "minecraft" without inject` —— 属性代理只对已声明的名字放行。**必须**用 `ctx.get()`。

**规则**：

- Cortex **必须** inject 它需要的必需 capability
- inject 的是 **capability token**（`"message"`），不是实现（`"satori"`）
- 除 capability service 外，不要 inject 具体插件
- package.json 的 `cordis.service.optional` 只是**给 WebUI 看的元数据**，不影响 cordis 运行时行为

### 3.4 生命周期：`*[Service.init]()`

需要在启动时做副作用、并在销毁时清理的，用 generator：

```typescript
*[Service.init]() {
  const dispose = someSetup();
  yield dispose;          // fiber dispose 时自动调用
}
```

**要点**：

- `yield` 出去的函数会被 cordis 在 fiber dispose 时自动执行
- 无需清理时 `yield;`（裸 yield）
- **不要**自己写 `start()` / `stop()` / `dispose()` 方法 —— 遵循 fiber 语义
- 构造函数中的 `ctx.on(...)` / `ctx.plugin(...)` 会随 fiber 自动清理，无需手动 yield disposer

真实例子（`Cortex` 基类）：

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

### 3.5 `this.ctx` 的陷阱

Cordis 在 service 被通过 traceable proxy 访问时（如从 root `ctx.get("message")`）会把 `this.ctx` **重绑定**到调用方的 context。若你的逻辑依赖构造时的 context（例如为了解析某个 isolate symbol），**必须**自己存一份引用：

```typescript
export default class MessageService extends Service<Config> {
  /**
   * Cordis 会在 service 通过 traceable proxy 被访问时把 this.ctx 重绑定到
   * 调用方 context，而那个 context 可能解析不到 `satori` isolate。
   * 保留自己的引用，保证 bots 总是查对的 registry。
   */
  private _self: Context;

  constructor(ctx: Context) {
    super(ctx, "message");
    this._self = ctx;
    // ...
  }

  get bots() {
    return this._self.get("satori")?.bots ?? [];
  }
}
```

### 3.6 非 Service 的插件形态

不提供 service、只做副作用的插件，用 class + `static inject` 或函数式 `apply`：

```typescript
// class 形态（推荐，便于持有状态）
export default class SandboxNerve {
  public static readonly name = "sandbox-nerve";
  public static readonly inject = ["sandbox", "satori", "life"];

  constructor(private ctx: Context) {
    // 在构造函数中注册、订阅；随 fiber 自动清理
  }
}

// 函数形态（无状态时）
export function apply(ctx: Context, config: Config) {
  ctx.on("some-event", handler);
}
```

### 3.7 package.json 的 cordis service 元数据

每个提供或消费 service 的包，都在 package.json 中声明：

```json
{
  "cordis": {
    "service": {
      "implements": ["cortex"],
      "required": ["life", "message"]
    }
  }
}
```

这份元数据供 WebUI 插件管理与依赖可视化使用。**新增 service 时必须同步更新**，否则 UI 中依赖关系会缺失。

---

## 4. 命名规范

### 4.1 包名

见 [02-architecture.md](./02-architecture.md) §2.4。速记：

- `@athena-ai/core`、`@athena-ai/protocol`、`@athena-ai/ai` —— 库，无前缀
- `@athena-ai/capability-<name>` —— capability 契约
- `@athena-ai/cortex-<name>` —— Cortex 实现
- `@athena-ai/nerve-<name>` —— Nerve 实现
- `@athena-ai/plugin-<name>` —— 通用插件
- `@athena-ai/adapter-<name>` —— Satori adapter（vendored 或自建）

### 4.2 目录名

目录名去掉 scope 与冗余前缀：

| 包名                            | 目录                         |
| ------------------------------- | ---------------------------- |
| `@athena-ai/plugin-life`        | `plugins/life`               |
| `@athena-ai/plugin-sandbox`     | `plugins/sandbox`            |
| `@athena-ai/cortex-chat`        | `plugins/cortex-chat`        |
| `@athena-ai/nerve-onebot`       | `plugins/nerve-onebot`       |
| `@athena-ai/sandbox-nerve`      | `plugins/sandbox-nerve`      |

### 4.3 标识符

| 种类                | 风格                   | 例                                                                           |
| ------------------- | ---------------------- | ---------------------------------------------------------------------------- |
| 类 / 接口 / 类型    | `PascalCase`           | `MessageService`、`SandboxNerveHandle`、`ModelGroup`、`Candidate`            |
| 函数 / 变量 / 方法  | `camelCase`            | `createMessage`、`candidates`、`language`                                    |
| 私有成员            | `_` 前缀               | `_self`、`_cortex`、`_resolveBot`、`_handles`                                |
| 常量                | `SCREAMING_SNAKE`      | `SELF_ID`、`FILE_ROUTE`、`MIME_TYPES`、`DELETE_PREFIX`                       |
| Service provide key | `camelCase` 单词       | `life`、`message`、`cortex`、`sandbox`、`ai`                                 |
| Cordis 事件名       | `kebab-case`，`/` 分域 | `message`、`internal/session`、`cortex/before-drain`、`sandbox/send-message` |

### 4.4 文件名

- `kebab-case.ts`
- 入口一律 `src/index.ts`
- 单一职责的类拆成同名文件：`life.ts`、`cortex.ts`、`bot.ts`、`message.ts`
- 共享类型：`types.ts`；跨端共享的 wire 类型：`shared.ts`

---

## 5. 目录结构

### 5.1 `packages/` vs `plugins/`

|                    | `packages/`                 | `plugins/`                                             |
| ------------------ | --------------------------- | ------------------------------------------------------ |
| 内容               | 类型、基类、共享库          | 可安装的运行时单元                                     |
| 是否提供 Service   | 一般不（`ai` 是例外）       | 通常是                                                 |
| 是否出现在 app.yml | 一般不（`core` 在 prelude） | 是                                                     |
| 例                 | `core`、`protocol`、`protocol-im`、`ai` | `life`、`cortex-chat`、`nerve-onebot`、`sandbox` |

### 5.2 单包内部结构

```
plugins/<name>/
├── package.json          ← 含 cordis.service 元数据
├── tsconfig.json          ← extends 根 tsconfig.base.json
├── src/
│   ├── index.ts           ← 入口：导出 + declare module + default export
│   ├── <domain>.ts        ← 单一职责实现
│   └── shared.ts          ← 跨端共享 wire 类型（若有 client）
├── tests/
│   └── <name>.test.ts     ← 与 src 同级，不放在 src 内
└── client/                ← WebUI 前端资源（若有）
    ├── index.ts
    └── *.vue
```

### 5.3 入口文件的标准结构

```typescript
// 1. imports（oxfmt 自动排序）
import { Context, Service } from "cordis";

// 2. module augmentation
declare module "cordis" {
  interface Context {
    myService: MyService;
  }
}

// 3. 常量
const SOME_CONSTANT = "value";

// 4. Config 类型 + Schema
export interface Config { ... }
export const Config: Schema<Config> = Schema.object({ ... });

// 5. 主体实现
export default class MyService extends Service<Config> { ... }

// 6. 重导出
export * from "./shared";
export { Helper } from "./helper";
```

---

## 6. 错误处理

### 6.1 抛错原则

**抛错要带足够的定位信息。** 消息中包含实际值，而不只是"something failed"：

```typescript
// ✅ 好
throw new Error(`Bot not found: ${sid}`);
throw new Error(`Multiple bots available (${active.map((b) => b.sid).join(", ")}); specify botSid`);
throw new Error(`Only one Cortex per Life. Current: ${this._cortex.name}, attempted: ${cortex.name}`);
throw new Error(`Provider "${provider.id}" is already registered`);

// ❌ 差
throw new Error("bot not found");
throw new Error("conflict");
```

### 6.2 何时抛、何时记日志

| 场景                                               | 处理                                              |
| -------------------------------------------------- | ------------------------------------------------- |
| 配置错误 / 契约违反（如两个 Cortex 绑同一个 Life） | **抛** —— 让 cordis 标记 fiber 失败               |
| 找不到必需的寻址目标（bot sid 不存在）             | **抛** —— 调用方需要知道                          |
| 单次外部操作失败（发消息失败、adapter 掉线）       | **记日志**，不要让 Cortex 整体崩溃                |
| 可选功能不可用（memory backend 未配置）            | **warn** + 降级                                   |
| 配置文件中的可疑项                                 | **warn** + 收集到 warnings 数组，启动时一次性输出 |

Cortex 的事件处理器**必须**包 try/catch —— 一次回复失败不该杀掉整个 Cortex：

```typescript
private async onMessage(event: IMMessageEvent) {
  try {
    await event.body.sendMessage(event.channelId, [Element("text", { content: reply })]);
  } catch (e) {
    this.ctx.logger("cortex-chat").warn("Failed to reply:", e);
  }
}
```

### 6.3 不要吞异常

```typescript
// ❌ 静默吞掉
try {
  await risky();
} catch {}

// ✅ 至少记录
try {
  await risky();
} catch (e) {
  this.ctx.logger("scope").warn("risky() failed:", e);
}
```

---

## 7. 日志

### 7.1 获取 logger

```typescript
this.ctx.logger("cortex-chat").info("...");
this.ctx.logger("cortex-chat").warn("...");
this.ctx.logger("cortex-chat").error("...");
this.ctx.logger("cortex-chat").debug("...");
```

或在构造函数中缓存：

```typescript
private readonly logger: Logger;

constructor(ctx: Context, config: Config) {
  this.logger = ctx.logger("athena.model");
  this.logger.level = config.logLevel ?? 2;
}
```

### 7.2 命名约定

logger scope 用**包名去 scope 后的部分**，或 `athena.<domain>`：

- `cortex-chat`
- `message`
- `ai`
- `sandbox`

### 7.3 级别语义

| 级别    | 用于                                                 |
| ------- | ---------------------------------------------------- |
| `error` | 需要人介入的失败                                     |
| `warn`  | 降级、跳过、可疑配置、单次操作失败                   |
| `info`  | 生命周期里程碑（provider 注册、bot 上线、Life 激活） |
| `debug` | 逐次调用的细节（模型解析、事件流转）                 |

### 7.4 结构化日志

调试用的 debug 日志优先传对象而非拼字符串：

```typescript
this.logger.debug("model.resolve_chat", {
  input: fullId,
  fullId: record.fullId,
  provider: record.providerId,
  model: record.modelId,
  modalities: record.config.modalities,
});
```

---

## 8. 测试策略

### 8.1 框架与位置

- **Vitest**，测试文件放在包的 `tests/` 目录（与 `src/` 同级，不在 `src/` 内）
- 命名 `<subject>.spec.ts`
- 跨包 import 使用相对路径直接导入源文件（如 `../../../packages/ai/src/index.js`），不配置 `resolve.alias`

### 8.2 核心测试模式：真实 Context

**不 mock Cordis。** 直接 `new Context()` 并安装真实插件 —— 这是验证 inject / isolate / fiber 行为的唯一可靠方式：

```typescript
import { Context } from "cordis";
import { describe, it, expect } from "vitest";

describe("CortexChat", () => {
  it("activates when both life and message are available", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { persona: { name: "Alice", description: "Test", traits: {} } });
    await ctx.plugin(MessageService, {});
    await ctx.plugin(CortexChat);
    expect(ctx.cortex).toBeInstanceOf(CortexChat);
  });
});
```

### 8.3 验证 inject 未满足

**关键技巧**：不要 `await` —— 依赖未满足时 fiber 会停在 PENDING，`await` 会挂住：

```typescript
it("does not activate without message service", async () => {
  const ctx = new Context();
  await ctx.plugin(Life, { persona: { name: "Alice", description: "Test", traits: {} } });
  // 不要 await —— 'message' inject 未满足，fiber 停在 PENDING
  ctx.plugin(CortexChat);
  expect(ctx.get("cortex")).toBeUndefined();
});
```

### 8.4 验证 isolate 行为

```typescript
function createDomain() {
  const ctx = new Context();
  const inner = ctx.isolate("satori").isolate("bots");
  return { ctx, inner };
}

it("group isolation hides satori outside while message stays visible", async () => {
  const { ctx, inner } = createDomain();
  await inner.plugin(MessageService, {});
  // 断言 satori 在外层不可见，message 可见
});
```

### 8.5 Stub 与 Fake

**StubBot** —— 继承真实 `Bot`，让 `session.bot.ctx` 反映真实 domain：

```typescript
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
```

**FakeClient / FakeWebUI / FakeLife** —— 对外部基础设施（WebUI、浏览器 socket）用最小 fake：

```typescript
class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];
  send(payload: Frame) {
    this.frames.push(payload);
  }
  last(type: string) {
    return this.frames.filter((f) => f.type === type).at(-1);
  }
}
```

原则：**Cordis 与 Satori 用真的，外部世界用 fake。**

### 8.6 访问私有状态

测试需要断言私有字段时，用 `Reflect.get` 并写个具名 helper：

```typescript
function getCortex(life: Life): Service | null {
  return Reflect.get(life, "_cortex") as Service | null;
}

expect(getCortex(ctx.life)).toBe(mockCortex);
```

不要为了测试把私有字段改成 public。

### 8.7 必须覆盖的场景

新增 Service 时，至少覆盖：

1. **安装后 service 可见** —— `expect(ctx.myService).toBeInstanceOf(MyService)`
2. **inject 未满足时不激活** —— 逐个缺失依赖各测一次
3. **dispose 后资源释放** —— disposer 被调用、引用被清空
4. **契约边界** —— 抛错路径（重复注册、找不到目标、多义寻址）
5. **隔离正确性**（若涉及 isolate）—— 跨 domain 不串台

新增 Cortex 时额外覆盖：绑定到 Life、事件订阅生效、无 bot 时的降级行为。

---

## 9. 依赖规则

### 9.1 硬约束

| 规则                                                        | 理由                                                                             |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Cortex → `capability-*`，**永不** → `nerve-*` / `adapter-*` | 依赖倒置；换 adapter 不动 Cortex                                                 |
| Capability **不**依赖 `@athena-ai/core`                     | Capability 是纯 cordis + 实现库；连接在 Cortex 层                                |
| `protocol` 不依赖任何 capability / plugin                   | 保持协议层无环                                                                   |
| Vendor 包只被 capability 引用                               | 隔离上游 alpha 风险                                                              |
| 任何 Service 都**不**在构造函数调 `ctx.mixin()`             | 全进程 accessor 名冲突（见 [05-lessons-learned.md](./05-lessons-learned.md) §1） |

### 9.2 依赖字段的选择

| 字段               | 用于                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------ |
| `dependencies`     | 运行时真正需要打包/解析的实现库（`ai`、`zod`、`schemastery`、`@athena-ai/protocol`） |
| `peerDependencies` | 由宿主提供的单实例（`cordis`）、以及只需类型的 workspace 包                          |
| `devDependencies`  | 仅编译期需要（`cordis` 的类型、`@athena-ai/core`）                                   |

**`cordis` 必须是 `peerDependencies`。** 多份物理副本会导致 ESM 模块身份不同（`Context === Context` 为 `false`），进而 Symbol 不匹配。参考 `cortex-chat/package.json`：

```json
{
  "dependencies": { "ai": "^7.0.0", "zod": "^3.25.76" },
  "devDependencies": { "@athena-ai/core": "workspace:*", "cordis": "^4.0.0-rc.8" },
  "peerDependencies": {
    "@athena-ai/core": "workspace:*",
    "@athena-ai/plugin-life": "workspace:*",
    "@athena-ai/protocol": "workspace:*",
    "@athena-ai/protocol-im": "workspace:*",
    "@cordisjs/element": "^0.3.0",
    "cordis": "^4.0.0-rc.8"
  }
}
```

workspace 内互相引用统一用 `"workspace:*"`。

### 9.3 package.json exports 模板

所有包统一：

```json
{
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
  }
}
```

### 9.4 单一 cordis realm

部署仓库（如 boilerplate）中若 `@athena-ai/*` 是 symlink，ESM 会从物理路径解析，可能引入第二份 cordis。用 `resolutions` 强制单一解析：

```json
{
  "resolutions": {
    "cordis": "^4.0.0-rc.8"
  }
}
```

---

## 10. 注释规范

### 10.1 何时写注释

**解释"为什么"，不解释"是什么"。** 代码已经说明了做什么。

值得写的：

- 非显然的约束与其来源（cordis proxy 行为、accessor 全局性）
- 为什么选了看起来更绕的做法
- 与上游/spec 的偏差
- 陷阱警告

不值得写的：

- 重复函数名的注释
- 逐行翻译代码

### 10.2 高价值注释的实例

```typescript
/**
 * Cordis wraps values passed through event hooks in traced proxies so that
 * `.ctx` follows the receiver. `Symbol.for("cordis.original")` is the proxy's
 * escape hatch back to the underlying object.
 */
const ORIGINAL = Symbol.for("cordis.original");
```

```typescript
// Every `Session` dispatched by Satori is broadcast on the *global*
// `internal/session` bus, so every MessageService in the process sees it.
// Each instance must decide whether the session belongs to its own domain
// and, if so, restrict delivery to hooks in the matching `message` isolate.
```

### 10.3 语言

**代码注释用英文**（与上游生态一致，便于外部协作）。**文档用中文**（本 `docs/` 体系）。

### 10.4 TSDoc

公开 API 用 `/** */`，简洁到一行为佳：

```typescript
/** Bots registry — proxy to the Satori bots of this isolation domain */
get bots(): Bot[] & Dict<Bot> { ... }

/** Send a message (creates message objects) */
async createMessage(...): Promise<Message[]> { ... }
```

接口字段逐条注释（对 AI agent 读者尤其有价值）：

```typescript
export interface SandboxDispatchPayload {
  /** WebUI client id (browser tab). */
  clientId: string;
  /** Sandbox platform identifier (unique per browser tab). */
  platform: string;
  /** Transport for bot replies back to the originating browser tab. */
  sink: MessageSink;
}
```

---

## 11. 提交与 PR

### 11.1 提交

- 提交前跑 `yarn lint` + `yarn format` + `yarn test`（pre-commit hook 覆盖前两项）
- 一个提交一件事
- 修改 vendored 代码单独成提交，标题写明是 vendor 改动

### 11.2 涉及架构不变式的改动

若改动触及 [02-architecture.md](./02-architecture.md) §12 的十条不变式之一，PR 描述中必须：

1. 指明触及了哪条
2. 说明为什么必须触及
3. 说明是否推向了任一条退化测试（[01-design-philosophy.md](./01-design-philosophy.md) §8.1）

### 11.3 同步文档

以下改动**必须**同步更新文档：

| 改动                            | 更新                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 新增/移除 package               | [02-architecture.md](./02-architecture.md) §2、[06-progress-and-roadmap.md](./06-progress-and-roadmap.md)   |
| 新增 Service / capability token | [02-architecture.md](./02-architecture.md) §6.1、[04-patterns-and-recipes.md](./04-patterns-and-recipes.md) |
| 修改 vendored 代码              | [02-architecture.md](./02-architecture.md) §11.3、[05-lessons-learned.md](./05-lessons-learned.md)          |
| 踩到新坑并解决                  | [05-lessons-learned.md](./05-lessons-learned.md)                                                            |
| 完成 roadmap 项                 | [06-progress-and-roadmap.md](./06-progress-and-roadmap.md)                                                  |
| 新的设计决策                    | `.specify/specs/` + [appendix/C-decision-index.md](./appendix/C-decision-index.md)                          |
