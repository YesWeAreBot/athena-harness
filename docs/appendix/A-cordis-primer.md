# 附录 A · Cordis v4 速查

> 面向从未用过 Cordis 的读者。所有断言均对照 `references/cordis/packages/core/src/` 源码核验，附文件行号。
>
> 核验版本：`cordis@^4.0.0-rc.8`（`references/cordis` = v4-beta 分支）

---

## 1. Cordis 是什么

一个**通用的插件化组合框架**，只做三件事：

1. **依赖注入** —— Service 注册与查找
2. **生命周期管理** —— Fiber 状态机、自动资源回收
3. **事件系统** —— 五种 dispatch 模式

**Cordis 不包含任何消息收发能力。** IM、HTTP、数据库全都是它之上的插件。Koishi 与 Athena 都是"cordis 之上的框架"。

---

## 2. Context

### 2.1 本质：一个被 Proxy 包裹的对象

```typescript
// context.ts:36-49
constructor() {
  this[symbols.isolate] = Object.create(null)
  this[symbols.intercept] = Object.create(null)
  const self = new Proxy<this>(this, ReflectService.handler)
  this.root = self
  this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])
  this.reflect = new ReflectService(self)
  this.registry = new RegistryService(self)
  this.events = new EventsService(self)
  this.logger = new LoggerService(self)
  return self                                   // ← 返回 Proxy，不是 this
}
```

`new Context()` 返回的是 **Proxy**。所有属性访问都经过 `ReflectService.handler`，这是"访问未 inject 的 service 会抛错"的实现机制。

### 2.2 内置属性

| 属性           | 类型              | 作用                                    |
| -------------- | ----------------- | --------------------------------------- |
| `ctx.events`   | `EventsService`   | 事件系统                                |
| `ctx.logger`   | `LoggerService`   | 日志（也可 `ctx.logger('scope')` 调用） |
| `ctx.reflect`  | `ReflectService`  | service 注册与属性描述符                |
| `ctx.registry` | `RegistryService` | 插件注册表                              |
| `ctx.fiber`    | `Fiber`           | 当前 context 所属的 fiber               |
| `ctx.root`     | `Context`         | 根 context                              |

以下方法通过 `mixin` 挂在 context 上（`reflect.ts:144-147`）：

```typescript
this.mixin("reflect", ["get", "set", "provide", "accessor", "mixin"]);
this.mixin("fiber", ["runtime", "effect"]);
this.mixin("registry", ["inject", "plugin"]);
this.mixin("events", ["on", "once", "parallel", "emit", "serial", "bail", "waterfall"]);
```

所以 `ctx.on(...)` 实际是 `ctx.events.on(...)`，`ctx.plugin(...)` 实际是 `ctx.registry.plugin(...)`。

### 2.3 `extend()` —— 原型链继承

```typescript
// context.ts:55-63
extend(meta = {}): this {
  const self = Object.create(getTraceable(this, this))
  for (const prop of Reflect.ownKeys(meta)) {
    Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop)!)
  }
  return self
}
```

创建一个以当前 context 为原型的新对象，并覆盖指定属性。**不是复制** —— 未覆盖的属性沿原型链查找。

### 2.4 `isolate()` —— 隔离 service 命名空间

```typescript
// context.ts:65-69
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

`ctx[symbols.isolate]` 是一个 `Dict<symbol>`，把 service 名映射到 Symbol。`isolate(name)` 用原型链 shadow 该映射，给 `name` 换一个新 Symbol。

**效果**：在新 context 中 `provide(name, ...)` 写入不同的 store slot，对原 context 不可见。

```typescript
const root = new Context();
const a = root.isolate("db");
const b = root.isolate("db");
// a 与 b 各有独立的 'db' service slot；root 又是第三个
```

### 2.5 `intercept()` —— 注入配置

```typescript
// context.ts:73-77
intercept(name: string, config: any) {
  const intercept = Object.create(this[symbols.intercept])
  intercept[name] = config
  return this.extend({ [symbols.intercept]: intercept })
}
```

沿原型链累积配置，被 `Service[symbols.resolveConfig]`（`service.ts:51-67`）合并。用于"对某个 service 在此子树内应用特定配置"。

### 2.6 静态 Symbol

```typescript
Context.effect; // symbols.effect
Context.filter; // symbols.filter      ← 事件过滤器
Context.isolate; // symbols.isolate     ← 隔离映射
Context.intercept; // symbols.intercept
Context.is(value); // 类型守卫
```

---

## 3. Service

### 3.1 定义

```typescript
// service.ts:18-35
constructor(protected ctx: Context, name: string) {
  name ??= this.constructor['provide'] as string
  let self = this
  const tracker: Tracker = { associate: name, property: 'ctx' }
  if (self[symbols.invoke]) {
    self = createCallable(name, joinPrototype(...), tracker)
  }
  self.ctx = ctx
  self.name = name
  defineProperty(self, symbols.tracker, tracker)
  self.ctx.reflect.provide(name, self, this[symbols.check])   // ← 自动注册
  return self
}
```

要点：

- `super(ctx, name)` 的第二个参数就是 **provide key**
- 构造函数**自动**调用 `provide()` —— 无需手写
- `name` 也可来自静态 `provide` 属性
- 返回 `self`，可能是 callable proxy（若定义了 `[Service.invoke]`）

最小 Service：

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
}
```

> ⚠️ **`Service<T>` 不提供 `this.config`。** 基类只有：
>
> ```typescript
> export abstract class Service<out T = never> {
>   declare [symbols.config]: T      // ← 仅类型标记
>   public name!: string
>   constructor(protected ctx: Context, name: string) { ... }
> }
> ```
>
> `T` 只用于 `intercept` 的配置类型推导（`[symbols.resolveConfig]`，`service.ts:51-67`）。想访问配置必须自己声明：
>
> ```typescript
> constructor(
>   ctx: Context,
>   public config: Config,
> ) {
>   super(ctx, "greeter");
> }
> ```

### 3.2 静态 Symbol

```typescript
Service.init; // *[Service.init]() —— 初始化 generator
Service.check; // 可用性检查
Service.config; // 配置类型标记
Service.invoke; // 使 service 可被调用（如 ctx.logger('x')）
Service.extend; // 扩展实例
Service.tracker; // context 追踪配置
Service.resolveConfig; // 配置合并
```

### 3.3 `*[Service.init]()` —— 初始化与清理

Fiber 执行插件后会检查返回的 "effect"（`fiber.ts:239-271`）：

| 返回值类型              | 处理                                           |
| ----------------------- | ---------------------------------------------- |
| `function`              | 直接作为 disposer 收集                         |
| `null` / `undefined`    | 忽略                                           |
| `Promise`               | await 后收集结果                               |
| `Iterable`（generator） | 逐个 `next()`，每个 `value` 作为 disposer 收集 |
| `AsyncIterable`         | 同上，异步                                     |
| 其他 object             | 抛 `TypeError: Invalid effect`                 |

所以 generator 的每个 `yield` 值都被当作 disposer：

```typescript
*[Service.init]() {
  const timer = setInterval(() => this.tick(), 1000);
  yield () => clearInterval(timer);          // ← fiber dispose 时执行

  const unsub = external.subscribe(handler);
  yield unsub;                                // ← 可以 yield 多次
}
```

无需清理时写裸 `yield;`（value 为 `undefined`，被忽略）。

**Disposer 按逆序执行**（`fiber.ts:283`：`disposables.splice(0).reverse()`）。

### 3.4 `ctx.effect()` —— 手动创建可清理的副作用

```typescript
// fiber.ts:277
effect(execute: () => Effect, label = 'anonymous'): any
```

在构造函数或任意时机注册清理逻辑：

```typescript
constructor(private ctx: Context) {
  const unregister = ctx.someHub.register(this);
  ctx.effect(() => {
    return () => unregister();
  }, "my-plugin.cleanup");
}
```

`execute` 的返回值遵循与 `[Service.init]` 相同的 effect 协议（function / Promise / generator）。`label` 用于调试（`ctx.fiber.getEffects()` 可查看）。

**注意**：`effect()` 会先 `assertActive()` —— 在非活跃 context 上调用会抛 `cannot create effect on inactive context`。

### 3.5 `provide` 与 store

```typescript
// reflect.ts:175-203
provide(name: string, value?: any, check?: () => boolean) {
  return this.ctx.fiber.effect(() => {
    if (!this.props[name]) {
      this.props[name] ??= { type: 'service' }
    } else if (this.props[name].type !== 'service') {
      throw new Error(`property "${name}" is already declared as ${this.props[name].type}`)
    }
    this.props[name] = { type: 'service' }

    this.ctx.root[symbols.isolate][name] ??= Symbol(name)
    const key = this.ctx[symbols.isolate][name]      // ← Symbol
    const impl: Impl = { name, value, fiber: this.ctx.fiber, check }
    if (this.store[key]) {
      throw new Error(`service "${name}" has been registered at <${this.store[key].fiber.name}>`)
    }
    this.store[key] = impl                            // ← Symbol 键
    // ...
  }, `ctx.provide(${JSON.stringify(name)})`)
}
```

**关键**：

- `store` 用 **Symbol** 键 → **受 isolate 影响** ✅
- `props` 用 **String** 键 → **不受 isolate 影响** ❌
- 同一 Symbol 下重复 provide → 抛 `service "X" has been registered at <...>`

### 3.6 属性查找：`ReflectService.handler.get`

```typescript
// reflect.ts:63-98（简化）
get: (target, prop, ctx) => {
  if (isSpecialProperty(prop)) return Reflect.get(target, prop, ctx);
  if (Reflect.has(target, prop)) return getTraceable(ctx, Reflect.get(target, prop, ctx));

  const error = new Error(`cannot get property "${prop}" without inject`);
  const def = target.reflect.props[prop];
  if (def?.type === "accessor") return def.get.call(ctx, ctx[symbols.receiver], error);
  if (!ctx.fiber.runtime) return ctx.reflect.get(prop, false);

  return ctx.events.waterfall("internal/get", ctx, prop, error, () => {
    const key = target[symbols.isolate][prop];
    let fiber = ((ctx[symbols.shadow] as Context) ?? ctx).fiber;
    while (true) {
      const impl = fiber.store?.[prop];
      if (impl) return getTraceable(ctx, impl.value);
      if (prop in fiber.inject) {
        error.message = `cannot get required service "${prop}" in inactive context`;
        throw error;
      }
      if (!fiber.runtime) throw error;
      if (fiber.parent[symbols.isolate][prop] !== key) throw error; // ← 隔离边界
      fiber = fiber.parent.fiber;
    }
  });
};
```

要点：

1. **特殊属性直通** —— Symbol、`prototype`、`then`、数字串、`_` 开头（`reflect.ts:33-38`）
2. **沿 fiber 链向上查找** —— 从当前 fiber 的 store 开始，逐级向 parent
3. **隔离边界即终止条件** —— `fiber.parent[isolate][prop] !== key` 时停止向上
4. **未 inject 且未找到 → 抛错** `cannot get property "X" without inject`

因此：

```typescript
ctx.someService; // 未 inject 且未 provide → 抛错
ctx.get("someService"); // 安全，返回 undefined
```

### 3.7 `ctx.get()` —— 安全查找

```typescript
// reflect.ts:150-160
get(name: string, strict = true) {
  return getTraceable(this.ctx, this._getImpl(name, strict)?.value)
}

_getImpl(name: string, strict = true) {
  const key = this.ctx[symbols.isolate][name]
  const impl = key && this.store[key]
  if (!impl) return
  if (strict && impl.fiber.state !== FiberState.ACTIVE) return   // ← 只返回活跃的
  return impl
}
```

`strict = true`（默认）时，只返回 fiber 状态为 `ACTIVE` 的 service。**表达可选依赖就用这个。**

### 3.8 `accessor` 与 `mixin` —— 全局唯一

```typescript
// reflect.ts:229-237
accessor(name: string, options: Omit<Property.Accessor, 'type'>) {
  return this.ctx.fiber.effect(() => {
    if (name in this.props) {
      throw new Error(`property "${name}" is already declared as ${this.props[name].type}`)
    }
    this.props[name] = { type: 'accessor', ...options }
    return () => delete this.props[name]
  }, `ctx.accessor(${JSON.stringify(name)})`)
}

// reflect.ts:239-264
mixin(source: any, mixins: string[] | Dict<string>) {
  return this.ctx.fiber.effect(function* () {
    const entries = Array.isArray(mixins) ? mixins.map(key => [key, key]) : Object.entries(mixins)
    for (const [key, value] of entries) {
      yield self.accessor(value, { get(...) {...}, set(...) {...} })
    }
  }, `ctx.mixin(...)`)
}
```

> ⚠️ **`props` 是 root ReflectService 上的单例字典（`reflect.ts:136`），键是字符串。`isolate` 对它零效果。**
>
> **推论：任何在构造函数中调 `ctx.mixin()` 的 Service，全进程只能有一个存活的 fiber。**

这是 Athena 移除 vendored Satori 的 `ctx.mixin('satori', ['bots', 'component'])` 的直接原因。详见 [../05-lessons-learned.md](../05-lessons-learned.md) §1。

### 3.9 三种注册机制对照

| 机制                   | 存储               | 键类型 | isolate 生效 | 冲突时                                |
| ---------------------- | ------------------ | ------ | ------------ | ------------------------------------- |
| `provide(name, value)` | `store[Symbol]`    | Symbol | ✅           | 抛 `service "X" has been registered`  |
| `accessor(name, opts)` | `props[name]`      | String | ❌           | 抛 `property "X" is already declared` |
| `mixin(source, keys)`  | 逐 key 调 accessor | String | ❌           | 同上                                  |

---

## 4. Fiber

### 4.1 是什么

每次 `ctx.plugin(...)` 创建一个 **Fiber** —— 该插件实例的生命周期单元。Fiber 持有：

- `ctx` —— 插件专属的扩展 context（`parent.extend({ fiber: this })`）
- `config` —— 解析后的配置
- `inject` —— 依赖声明（`Dict<config>`）
- `store` —— 该 fiber provide 的 service
- `_disposables` —— 收集到的清理函数

### 4.2 状态机

```typescript
// fiber.ts:78-85
export const enum FiberState {
  PENDING, // 依赖未满足，等待中
  LOADING, // 正在执行插件
  ACTIVE, // 已激活
  FAILED, // 执行出错
  DISPOSED, // 已销毁
  UNLOADING, // 正在销毁
}
```

状态推导（`fiber.ts:348-353`）：

```typescript
private _getState() {
  if (this.uid === null) return FiberState.DISPOSED
  if (this._error) return FiberState.FAILED
  if (this._runner.epoch !== INACTIVE) return FiberState.ACTIVE
  return FiberState.PENDING
}
```

**PENDING 是最常见的困惑来源**：插件安装了但 service 拿不到，几乎总是因为某个 `inject` 依赖未满足，fiber 停在 PENDING。

### 4.3 `ctx.plugin()` 返回可 await 的 Fiber

```typescript
// registry.ts:207-212
const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack);
const wrapped = Object.create(fiber) as Fiber & PromiseLike<Fiber>;
wrapped.then = (onFulfilled, onRejected) => fiber.await().then(onFulfilled, onRejected);
return wrapped;
```

```typescript
const fiber = ctx.plugin(MyService); // 立即返回，不阻塞
await ctx.plugin(MyService); // 等到激活（或失败）
await fiber.dispose(); // 销毁
```

> ⚠️ **测试陷阱**：若插件的 inject 依赖不可能被满足，`await ctx.plugin(...)` 会**永久挂住**。验证"依赖未满足时不激活"时**不要 await**：
>
> ```typescript
> ctx.plugin(CortexChat); // 不 await
> expect(ctx.get("cortex")).toBeUndefined();
> ```

### 4.4 依赖满足与自动重载

`provide` / `dispose` 时会调 `notify()`（`reflect.ts:205-227`），遍历所有 fiber，对 inject 了该名字且隔离匹配的 fiber 调 `_refresh()`。**依赖出现 → fiber 自动激活；依赖消失 → fiber 自动卸载。** 无需手写监听。

### 4.5 资源自动回收

Fiber dispose 时：

1. 逆序执行 `_disposables` 中的所有 disposer
2. `ctx.on()` / `ctx.plugin()` / `ctx.provide()` 全都通过 `fiber.effect()` 注册 → **自动清理**
3. 只有外部资源（timer、socket、第三方注册）需要显式 yield disposer

---

## 5. 插件

### 5.1 三种形态

```typescript
// registry.ts:63-92
export type Plugin<T = any> = Plugin.Function<T> | Plugin.Constructor<T> | Plugin.Object<T>;

interface Base<T> {
  name?: string;
  Config?: StandardSchemaV1<any, T>;
  inject?: Inject;
  provide?: string | string[];
  intercept?: Dict<boolean>;
}

interface Function<T> extends Base<T> {
  (ctx: Context, config: T): any;
}
interface Constructor<T> extends Base<T> {
  new (ctx: Context, config: T): any;
}
interface Object<T> extends Base<T> {
  apply(ctx: Context, config: T): any;
}
```

```typescript
// 函数式
export function apply(ctx: Context, config: Config) { ... }
apply.inject = ["life"];

// 类式（Service 或普通类）
export default class MyPlugin {
  static name = "my-plugin";
  static inject = ["life"];
  constructor(ctx: Context, config: Config) { ... }
}

// 对象式
export default {
  name: "my-plugin",
  inject: ["life"],
  apply(ctx: Context, config: Config) { ... },
};
```

### 5.2 `Plugin.Base` 只有四个静态字段

| 字段        | 作用                                                          |
| ----------- | ------------------------------------------------------------- |
| `name`      | 插件名（用于日志、WebUI）                                     |
| `Config`    | Standard Schema（schemastery / zod 等）                       |
| `inject`    | 依赖声明                                                      |
| `provide`   | 提供的 service 名（`Service` 基类用 `super(ctx, name)` 替代） |
| `intercept` | 拦截配置                                                      |

> ⚠️ **没有 `optional`。** cordis v4 的所有 `inject` 都是必需的。可选依赖用 `ctx.get()` 或嵌套 `ctx.inject()`。

### 5.3 `inject` 的两种写法

```typescript
// registry.ts:11
export type Inject<M = Dict> = (keyof M)[] | { [K in keyof M]?: M[K] };
```

```typescript
// 数组形式 —— 只声明依赖
static inject = ["life", "message"];

// 对象形式 —— 依赖 + intercept 配置
static inject = { life: null, http: { timeout: 5000 } };
```

`Inject.resolve()`（`registry.ts:43-60`）把两种形式归一化为 `Dict`，数组项的值为 `null`。

### 5.4 `ctx.inject()` —— 匿名依赖子 fiber

```typescript
// registry.ts:189-191
inject(inject: Inject, callback: Plugin.Function<void>) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}
```

创建一个只在依赖满足时激活的匿名插件：

```typescript
ctx.inject(["minecraft"], (scoped) => {
  scoped.on("minecraft/block-change", handler);
});
```

依赖消失时该子 fiber 自动卸载，`scoped.on` 注册的监听器自动清理。**这是表达"可选依赖"的推荐方式。**

### 5.5 `@Inject()` 装饰器

```typescript
// registry.ts:17-40
export function Inject<K extends InjectKey>(name: K, config?: ...)
```

可用于类或方法：

```typescript
@Inject("life")
export default class MyService extends Service { ... }

class MyService extends Service {
  @Inject("minecraft")
  protected onMinecraft() {
    // 只在 minecraft 可用时执行；内部自动创建 ctx.inject 子 fiber
  }
}
```

方法装饰器会在实例初始化时注册一个 `ctx.inject(inject, cb)` 子 fiber（`registry.ts:28-35`）。

---

## 6. 事件系统

### 6.1 五种 dispatch 模式

```typescript
// events.ts:14
export type DispatchMode = "emit" | "parallel" | "serial" | "bail" | "waterfall";
```

| 方法                              | 同步/异步 | 语义                                                       | 返回            |
| --------------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `emit(name, ...args)`             | 同步      | 依次调用全部 listener，忽略返回                            | `void`          |
| `parallel(name, ...args)`         | 异步      | `Promise.allSettled` 并发；有 reject 则抛 `AggregateError` | `Promise<void>` |
| `serial(name, ...args)`           | 异步      | 顺序 await，首个"bailed"值短路返回                         | `Promise<R>`    |
| `bail(name, ...args)`             | 同步      | 顺序调用，首个"bailed"值短路返回                           | `R`             |
| `waterfall(name, ...args, inner)` | 同步      | **`next()` 中间件链**                                      | `R`             |

### 6.2 `isBailed` 判定

```typescript
// events.ts:6-8
export function isBailed(value: any) {
  return value !== null && value !== false && value !== undefined;
}
```

> ⚠️ `0` 与 `""` **会**触发短路。只有 `null` / `false` / `undefined` 视为"继续"。

### 6.3 `waterfall` 是中间件链，不是 reduce

```typescript
// events.ts:117-126
waterfall(...args: any[]) {
  const [thisArg, callbacks] = this._resolve('waterfall', args)
  const inner = args.pop()                 // ← 最后一个参数是链尾回调
  const next = () => {
    const callback = callbacks.shift()
    return callback ? Reflect.apply(callback, thisArg, args) : inner(...args)
  }
  args.push(next)                          // ← next 追加到 args 尾部
  return next()
}
```

**调用方**必须提供链尾 `inner`：

```typescript
// ✅
const result = ctx.waterfall("my-hook", payload, (p) => defaultBehavior(p));

// ❌ 漏掉 inner —— payload 会被 pop 当成 inner
const result = ctx.waterfall("my-hook", payload);
```

**listener** 的最后一个参数是 `next`，必须调用它才会继续下游：

```typescript
ctx.on("my-hook", (payload, next) => {
  payload.extra = "injected"; // 原地修改（next 不接收参数）
  return next(); // 放行
});

ctx.on("my-hook", (payload, next) => {
  if (shouldBlock) return fallbackValue; // 短路，不调 next
  return next();
});
```

内置事件里就是这个形状（`events.ts:173-175`）：

```typescript
'internal/update'(this: Fiber, config: any, noSave: boolean, next: () => void): void
'internal/get'(ctx: Context, name: string, error: Error, next: () => any): any
'internal/set'(ctx: Context, name: string, value: any, error: Error, next: () => boolean): boolean
```

### 6.4 `[Context.filter]` —— 事件作用域过滤

```typescript
// events.ts:72-81
private _resolve(type: string, args: any[]) {
  const thisArg = typeof args[0] === 'object' || typeof args[0] === 'function' ? args.shift() : null
  const name: string = args.shift()
  if (!name.startsWith('internal/') && this._hooks['internal/dispatch']?.length) {
    this.emit('internal/dispatch', type, name, args, thisArg)
  }
  const filter = thisArg?.[Context.filter]
  return [thisArg, (this._hooks[name] || [])
    .filter(hook => hook.global || !filter || filter.call(thisArg, hook.ctx))
    .map(hook => hook.callback)] as const
}
```

机制：

1. 每个 listener（`Hook`）记住注册所在的 `ctx`（`events.ts:41`、`events.ts:131`）
2. 事件发射时若第一个参数是 object/function，它被当作 `thisArg`
3. 若 `thisArg[Context.filter]` 存在，对每个 `hook.ctx` 调用它 —— **只有返回 `true` 的 hook 收到事件**
4. 若 filter 不存在 → 全部 hook 收到（广播）
5. `options.global === true` 的 hook 无视 filter

用法（Athena 的 MessageService 就用这个做多 Life 隔离）：

```typescript
payload[Context.filter] = (hookCtx: Context) => {
  return hookCtx[Context.isolate]["message"] === myMessageSymbol;
};
ctx.emit(payload, "some-event", ...args);
```

### 6.5 `ctx.on()` 的自动清理

```typescript
// events.ts:128-134
register(label: string, hooks: Hook[], callback: any, options: EventOptions): () => void {
  const method = options.prepend ? 'unshift' : 'push'
  return this.ctx.fiber.effect(() => {
    hooks[method]({ ctx: this.ctx, callback, ...options })
    return () => this.unregister(hooks, callback)
  }, label)
}
```

`ctx.on()` 走 `fiber.effect()` → **随 fiber dispose 自动注销**。无需手动保存返回值。

### 6.6 选项

```typescript
// events.ts:35-38
export interface EventOptions {
  prepend?: boolean; // 插到 listener 列表头部
  global?: boolean; // 无视 [Context.filter]
}
```

```typescript
ctx.on("message", handler, { prepend: true });
ctx.on("message", handler, true); // 等价于 { prepend: true }
ctx.on("message", handler, { global: true }); // 收所有 Life 的事件
```

### 6.7 内置事件

```typescript
// events.ts:169-178
export interface Events {
  "internal/plugin"(fiber: Fiber): void;
  "internal/status"(fiber: Fiber, oldValue: FiberState): void;
  "internal/service"(this: Context, name: string, value: any): void;
  "internal/update"(this: Fiber, config: any, noSave: boolean, next: () => void): void;
  "internal/get"(ctx: Context, name: string, error: Error, next: () => any): any;
  "internal/set"(ctx: Context, name: string, value: any, error: Error, next: () => boolean): boolean;
  "internal/listener"(this: Context, name: string, listener: any, prepend: boolean): void;
  "internal/dispatch"(mode: DispatchMode, name: string, args: any[], thisArg: any): void;
}
```

`internal/` 前缀的事件不触发 `internal/dispatch`（避免无限递归）。

### 6.8 声明自定义事件

```typescript
declare module "cordis" {
  interface Events {
    "my-plugin/something-happened"(payload: MyPayload): void;
  }
}
```

---

## 7. Loader 与配置

> Loader 不在 `packages/core` 中，属于 `@cordisjs/loader` / `@cordisjs/plugin-cli-cordis`。以下是使用层面的速查。

### 7.1 `cordis.yml` —— bootstrap

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

### 7.2 Prelude vs Managed

|            | Prelude                        | Managed       |
| ---------- | ------------------------------ | ------------- |
| 声明位置   | `cordis.yml` 的 `prelude` 数组 | `app.yml`     |
| 加载时机   | loader 解析 `app.yml` **之前** | loader 启动后 |
| WebUI 可见 | ❌                             | ✅            |
| 可卸载     | ❌                             | ✅            |

**框架身份由 prelude 定义** —— 这是 Koishi 与 Athena 都采用的结构。

### 7.3 `app.yml` —— 插件树

```yaml
- name: "@cordisjs/plugin-webui"
- name: "@athena-ai/plugin-sandbox"

- name: "@cordisjs/plugin-group"
  label: Alice
  isolate:
    life: true
    cortex: true
  config:
    - name: "@athena-ai/plugin-life"
      config:
        persona: { name: Alice, description: "...", traits: {} }
    - name: "@athena-ai/cortex-chat"
```

条目字段：

| 字段        | 作用                                             |
| ----------- | ------------------------------------------------ |
| `name`      | 包名或相对路径                                   |
| `config`    | 插件配置（group 时是子条目数组）                 |
| `label`     | 显示名（WebUI）                                  |
| `isolate`   | `Dict<boolean \| string>` —— 要隔离的 service 名 |
| `intercept` | service 配置注入                                 |
| `disabled`  | 禁用该条目                                       |

### 7.4 常用生态插件

| 插件                               | 作用                      |
| ---------------------------------- | ------------------------- |
| `@cordisjs/plugin-group`           | 分组 + isolate 声明       |
| `@cordisjs/plugin-include`         | 引入外部 YAML 文件        |
| `@cordisjs/plugin-env`             | 加载 `.env`               |
| `@cordisjs/plugin-logger-console`  | 控制台日志                |
| `@cordisjs/plugin-hmr`             | 热重载                    |
| `@cordisjs/plugin-webui`           | Web 管理界面              |
| `@cordisjs/plugin-server`          | HTTP 服务器               |
| `@cordisjs/plugin-http`            | HTTP 客户端（`ctx.http`） |
| `@cordisjs/plugin-database-sqlite` | SQLite                    |

---

## 8. Logger

```typescript
ctx.logger("scope").info("message");
ctx.logger("scope").warn("message", errorObject);
ctx.logger("scope").error(err);
ctx.logger("scope").debug("detail", { structured: "payload" });

// 缓存后设级别
const logger = ctx.logger("athena.model");
logger.level = 2; // 0=silent 1=error 2=warn 3=info 4=debug
```

`ctx.logger` 是一个定义了 `[Service.invoke]` 的 Service —— 因此既能 `ctx.logger.error(...)` 也能 `ctx.logger('scope').error(...)`。

---

## 9. 常见陷阱速查

| 陷阱                       | 说明                                                                    | 详见                                   |
| -------------------------- | ----------------------------------------------------------------------- | -------------------------------------- |
| `ctx.mixin()` 全进程唯一   | `props` 是单例字符串字典，isolate 无效                                  | §3.8                                   |
| `isolate` 只隔离 `store`   | `provide` 受影响，`accessor` / `mixin` 不受                             | §3.9                                   |
| Proxy identity             | `serviceA === serviceB` 可能为 false；按 `.name` 比较                   | [../05](../05-lessons-learned.md) §3   |
| `this.ctx` 被重绑定        | 通过 traceable proxy 访问时指向调用方；需自存 `_self`                   | [../05](../05-lessons-learned.md) §3.4 |
| traced proxy 的 `.ctx`     | 事件载荷的 `.ctx` 指向接收方；需 `Symbol.for("cordis.original")` unwrap | [../05](../05-lessons-learned.md) §3.5 |
| 无 `static optional`       | 所有 inject 均必需；可选用 `ctx.get()` / `ctx.inject()`                 | §5.2                                   |
| `waterfall` 不是 reduce    | 是 `next()` 中间件链；调用方需给 `inner`                                | §6.3                                   |
| `isBailed(0)` 为 true      | `0` 和 `""` 会短路                                                      | §6.2                                   |
| `await ctx.plugin()` 挂住  | 依赖永不满足时 fiber 停在 PENDING                                       | §4.3                                   |
| `ctx.someService` 抛错     | 未 inject 的属性访问会抛，用 `ctx.get()`                                | §3.6                                   |
| 多份 cordis 副本           | Symbol 身份不同导致隔离/过滤静默失效                                    | [../05](../05-lessons-learned.md) §12  |
| `effect()` on inactive ctx | 抛 `cannot create effect on inactive context`                           | §3.4                                   |

---

## 10. 源码地图

`references/cordis/packages/core/src/`：

| 文件          | 内容                                                | 关键行                                                                              |
| ------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `context.ts`  | Context 类、`extend` / `isolate` / `intercept`      | 36-49（构造）、55-63（extend）、65-69（isolate）                                    |
| `service.ts`  | Service 基类、自动 provide、config 合并             | 18-35（构造）、37-39（filter）、51-67（resolveConfig）                              |
| `reflect.ts`  | 属性代理、provide / accessor / mixin、store / props | 63-133（handler）、175-203（provide）、229-237（accessor）、239-264（mixin）        |
| `fiber.ts`    | Fiber 状态机、effect 协议、依赖刷新                 | 78-85（FiberState）、239-271（effect 协议）、277-340（effect）、348-353（状态推导） |
| `events.ts`   | 五种 dispatch、filter 机制、hook 注册               | 6-8（isBailed）、72-81（_resolve）、117-126（waterfall）、128-134（register）       |
| `registry.ts` | Plugin 类型、`plugin()` / `inject()`、`@Inject`     | 63-100（Plugin）、17-40（@Inject）、189-213（plugin/inject）                        |
| `logger.ts`   | LoggerService                                       | —                                                                                   |
| `utils.ts`    | `getTraceable`、`symbols`、`DisposableList`         | —                                                                                   |
