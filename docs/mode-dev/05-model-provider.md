# 05 Model Provider

## 这一节解决什么问题

一个 Mode 可能需要多个模型。

例如：

- Chat Mode 只需要一个主对话模型。
- World Mode 需要一个主模型，可能还需要一个压缩模型。
- Interlude Mode 需要主模型、压缩模型、embedding，甚至快速 gate 模型。

如果 Life 只允许“一个固定模型”，这些 Mode 都无法实现。

所以模型选择不能写死在 Life 里，也不能写死在 Agent 创建时。

它需要变成一个可替换的 provider。

## ModelProvider 是什么

ModeModelProvider 是一个“能提供某种角色模型”的实现。

```ts
interface ModeModelProvider {
  id: string;
  roles: ModeModelRole[];
  get(): Awaitable<unknown>;
  dispose?(): Awaitable<void>;
}
```

`get()` 返回的是真正可以传给 AgentLoop 的模型对象。

## role 是什么

`role` 表示这个模型用来做什么：

- `main`：主对话或主叙事模型。
- `compaction`：上下文压缩模型。
- `embedding`：向量模型。
- `gate`：快速判断模型。
- `custom`：Mode 自定义角色。

```ts
const provider = {
  id: "chat-main",
  roles: ["main"],
  get: async () => myLanguageModel,
};
```

## 在 Mode 中提供模型

Mode 通过 `providers.model` 把自己的模型选择交给 Life：

```ts
setup: async () => ({
  providers: {
    model: provider,
  },
});
```

Life 会让 `ModeContext.model` 能读取这些 provider：

```ts
const model = ctx.model?.resolve("main");
```

## 全局 ModelProviderRegistry

Mode 没有提供匹配 provider 时，Life 会回退到全局注册表。

```ts
ctx.plugin(modelProviderRegistry);

ctx.modelProviders.register({
  id: "fallback-main",
  roles: ["main"],
  get: async () => fallbackModel,
});
```

这个机制适合：

- 多个 Life 共享默认模型。
- Mode 不声明模型时兜底。
- 统一管理 failover 候选。

## 切换模型

Life 提供两个入口：

### 按 providerId 显式切换

```ts
await handle.setModel("chat-main");
```

这种适合你知道明确要用哪个 provider。

### 按 role failover

```ts
await handle.setModelByRole("main");
```

Life 会依次尝试所有声明 `main` 角色的 provider。

第一个失败后，自动尝试下一个。

## model/changed 和 model/error

切换成功会发：

```text
model/changed
```

切换失败会发：

```text
model/error
```

```ts
ctx.on("model/error", (event) => {
  console.log(event.providerId, event.role, event.error);
});
```

## 你现在应该理解什么

- 一个 Mode 可以有多个模型角色。
- 模型选择通过 ModeModelProvider 表达。
- Life 可以回退到全局 registry。
- Life 可以按 providerId 或 role 切换模型。
- 切换结果通过 model/changed 和 model/error 可观测。
