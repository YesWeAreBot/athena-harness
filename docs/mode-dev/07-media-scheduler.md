# 07 Media 与 Scheduler

## 这一节解决什么问题

数字生命不只是“发文字”。

它可能需要：

- 接收图片、语音、视频。
- 保存收藏夹。
- 给图片写描述。
- 管理自己的媒体资产。

同时，数字生命也不只是“收到消息才行动”。

它可能需要：

- 定时心跳。
- 处理到期的意图。
- 主动推进世界。
- 被唤醒后继续运行。

这一节解释 Media 和 Scheduler。

## MediaStore 是什么

MediaStore 是 athena-runtime 提供的文件级媒体存储。

它负责：

- 保存媒体文件。
- 读取媒体文件。
- 列出媒体文件。
- 删除媒体文件。

它保存媒体数据和元数据：

- id
- type
- mime
- size
- createdAt

## 使用 MediaStore

```ts
import { mediaStoreRegistry } from "@yesimbot/athena-runtime";

ctx.plugin(mediaStoreRegistry, { root: "./data/media" });
```

保存：

```ts
const file = await ctx.mediaStore.save({
  type: "image",
  mime: "image/png",
  data: buffer,
});
```

读取：

```ts
const entry = await ctx.mediaStore.get(file.id);
```

列出：

```ts
const files = await ctx.mediaStore.list();
```

删除：

```ts
await ctx.mediaStore.delete(file.id);
```

## ModeMediaProvider 是什么

MediaStore 是默认实现。

但 Mode 可能想要自己的媒体库：

- World 有 gallery。
- Interlude 有插图。
- Chat 有表情收藏。

所以 Mode 可以提供自己的 `ModeMediaProvider`。

```ts
const provider = {
  id: "gallery",
  list: async () => files,
  save: async (ref) => savedRef,
};

setup: async () => ({
  providers: { media: provider },
});
```

ModeContext 统一访问：

```ts
await ctx.media?.list();
await ctx.media?.save(ref);
```

## Scheduler 是什么

Scheduler 是主动行为的入口。

它不是“定时器工具”这么简单。

它要表达：

- 世界心跳：每过一段时间推进一次。
- 到期意图：某个计划到时间了。
- sweep：定期清理或推进。
- rest window：休息时间。

Mode 可以通过 `ModeContext.scheduler` 使用 Life 的 Scheduler。

## 使用 Scheduler

```ts
ctx.scheduler?.schedule({
  kind: "tingle",
  after: 1000,
  run: async () => {
    // 触发世界心跳
  },
});
```

## ModeSchedulerProvider 是什么

Life 的默认 Scheduler 可能不够。

World 需要世界时钟。

Interlude 需要 due-intent 和 rest window。

所以 Mode 可以提供自己的 `ModeSchedulerProvider`：

```ts
const provider = {
  id: "world-scheduler",
  kinds: ["tingle"],
  schedule: (options) => {
    // 自己的调度实现
  },
  cancel: (id) => {
    // 自己的取消实现
  },
  cancelAll: () => {
    // 自己的清理实现
  },
};
```

Mode 声明 provider 后，`ModeContext.scheduler` 会优先使用它。

## wake 是什么

wake 是 Life 主动唤醒 Mode 的入口。

它适合表达：

- 定时任务到期。
- 世界心跳。
- 外部系统注入。
- 测试触发。

```ts
await handle.wake("due-intent", {
  intentId: "intent-1",
});
```

`wake` 会变成一条 `bodyId: "life"`、`kind: "wake"` 的 Percept，并走正常路由。

## 你现在应该理解什么

- MediaStore 是默认媒体持久化。
- Mode 可以用自己的 ModeMediaProvider 替换。
- Scheduler 是主动行为入口。
- Mode 可以用自己的 SchedulerProvider。
- wake 是主动唤醒 Life 的入口。
