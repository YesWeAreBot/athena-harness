# 04 Memory

## 这一节解决什么问题

数字生命需要长期记忆。

但“记忆”不是一个统一的东西。

一个 Chat Bot 需要记住：

- 用户说过什么。
- Bot 喜欢什么。
- 哪些是可靠事实。

一个 World Bot 需要记住：

- 当前世界状态。
- 最近发生了什么大事。
- Bot 自己的私人小事。

一个 Interlude Bot 需要记住：

- 故事发展到哪里。
- 和不同参与者的关系。
- 有哪些承诺。
- 哪些意图还没有完成。

如果 athena-runtime 用一个统一记忆结构去装这些，结果不是方便，而是灾难。

所以设计原则是：

```text
Life 提供统一入口
Mode 提供记忆策略
```

## LifeMemory 是什么

LifeMemory 是 Life 的记忆门面。

它负责：

- 提供 `remember`、`recall`、`forget`、`clear` 等统一入口。
- 按 scope 路由到不同的 MemoryProvider。
- 管理 MemoryProvider 的注册和注销。
- 触发 `restore`、`derive`、`compact`。

它不负责：

- 决定什么值得记住。
- 决定怎么压缩。
- 决定什么时候遗忘。
- 决定用什么存储格式。

## MemoryProvider 是什么

MemoryProvider 是 Mode 提供的记忆实现。

它声明自己负责哪些 `scope`，并实现自己的存取逻辑。

```ts
interface MemoryProvider {
  id: string;
  scopes: MemoryScope[];
  remember(input: MemoryInput): Awaitable<MemoryRecord>;
  recall(lifeId: string, options?): Awaitable<MemoryRecord[]>;
  forget(id: string): Awaitable<boolean>;
  clear(lifeId: string): Awaitable<void>;
  restore?(lifeId: string): Awaitable<void>;
  derive?(lifeId: string, options?): Awaitable<MemoryRecord[]>;
  compact?(lifeId: string, options?): Awaitable<MemoryRecord[]>;
  dispose?(): Awaitable<void>;
}
```

## 每个方法解决什么问题

- `remember`：写入一条记忆。
- `recall`：按条件召回记忆。
- `forget`：删除一条记忆。
- `clear`：清空一个 Life 的记忆。
- `restore`：从自己的持久化里恢复。
- `derive`：从已有记忆生成派生记忆。
- `compact`：压缩记忆。
- `dispose`：释放 provider 自己的资源。

`derive`、`compact`、`restore` 都是可选的。

不是每个 Mode 都需要实现全部。

## 为什么 Life 只触发，不实现

Life 无法知道：

- Chat 的“重要”是什么。
- World 的“大事”是什么。
- Interlude 的“承诺”是什么。

这些判断必须由 Mode 的 provider 自己做。

Life 只负责：

- 在 Mode 创建后调用 `restore`。
- 在外界调用时路由 `remember/recall`。
- 在需要时调用 `derive/compact`。

## 怎么在 Mode 中注册 MemoryProvider

```ts
const provider = {
  id: "chat-memory",
  scopes: ["conversation", "facts"],
  remember: async (input) => {
    // 自己的存储逻辑
  },
  recall: async (lifeId, options) => {
    // 自己的召回逻辑
  },
  derive: async (lifeId) => {
    // 自己的派生记忆
  },
  compact: async (lifeId) => {
    // 自己的压缩策略
  },
  restore: async (lifeId) => {
    // 自己的恢复逻辑
  },
  dispose: async () => {
    // 释放自己的资源
  },
};

setup: async () => ({
  providers: { memory: provider },
});
```

## 使用 LifeMemory

```ts
await ctx.memory.remember({
  lifeId,
  scope: "facts",
  category: "fact",
  content: "Athena 喜欢茶",
});

await ctx.memory.recall(lifeId, {
  scope: "facts",
  query: "茶",
});

await ctx.memory.derive(lifeId);
await ctx.memory.compact(lifeId);
```

## Scope 建议

不同 Mode 可以使用不同 scope：

- Chat：`conversation`、`facts`
- World：`world`、`news`、`facts`
- Interlude：`story`、`participant`、`promise`

`MemoryScope` 是开放字符串，Mode 可以扩展自己的 scope。

## 你现在应该理解什么

- LifeMemory 是统一入口。
- MemoryProvider 是 Mode 自己的策略。
- Life 不决定记忆内容。
- Mode 通过 providers 注册自己的记忆实现。
- restore/derive/compact 都是 provider 能力，不是 Life 功能。
