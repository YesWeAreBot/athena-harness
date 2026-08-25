# 附录 D · Satori → Nerve 迁移记录

> 记录 2026-08-25 完成的 Satori → Nerve 完整迁移：**迁移进度**、**差异对照**、**未来方向**、**遗留问题**。
>
> 本文是**现状快照**，与代码同步维护。发现偏差时以代码为准。

---

## 1. 一句话总结

Athena 已从"vendored Satori v5 + capability-message 隔离层"迁移到**自研 Nerve 协议**：`protocol`（Body/NerveEvent/NerveService）+ `protocol-im`（IM 实体/事件/IMBody）+ `nerve-onebot`（平台 adapter）。`vendor/`、`capability-message`、`@satorijs/*` 依赖已全部删除。

迁移动机（当初为什么要换）：

1. **Satori 是"Universal Messenger Protocol"，Nerve 是"Life 与世界的接触面"** —— 继续用 Satori 命名持续产生认知摩擦
2. **不需要兼容 Satori 生态** —— Athena 不是 Koishi，不需要跑 Koishi 插件
3. **避免变成另一个 Koishi** —— 沿用 IM 平台那一套设计，未来可能走回 Koishi 的路
4. **accessor/mixin 冲突** —— vendored Satori 的 `ctx.mixin('satori', ['bots', 'component'])` 在多 Life 部署时全局 accessor 冲突（见 [05](../05-lessons-learned.md) §1）

---

## 2. 迁移进度

### 2.1 已完成的项（2026-08-25）

| 项                                        | 状态    | 说明                                                                                    |
| ----------------------------------------- | ------- | --------------------------------------------------------------------------------------- |
| 自研 `@athena-ai/protocol-im`             | ✅ 完成 | IM 实体类型、Methods 表、IMBody 默认实现、事件契约、MessageEncoder、WsClient            |
| 自研 `@athena-ai/nerve-onebot`            | ✅ 完成 | OneBot v11 完整 adapter：事件适配、CQCode、Internal API、WS/WS-reverse/HTTP 三模式      |
| `Body` 基类生命周期                       | ✅ 完成 | 默认 `*[Service.init]()`：注册 `ctx.nerve` + connect + dispose 断开                     |
| 事件声明合并                              | ✅ 完成 | 只在 `cordis.Events` 声明一份（satori/koishi 模式）                                     |
| 删除 `vendor/satorijs/*`                  | ✅ 完成 | core / protocol / element / adapter-onebot / adapter-qq / adapter-satori / url-is-local |
| 删除 `plugins/capability-message`         | ✅ 完成 | `ctx.message` 由 `cordis.Events` + `event.body` 替代                                    |
| `cortex-chat` 迁移                        | ✅ 完成 | `ctx.on("message-created")` + `event.body.sendMessage(...)`                             |
| `sandbox` / `sandbox-nerve` 迁移          | ✅ 完成 | SandboxBot 继承 `IMBody`；`ctx.nerve.get(sid)` 寻址                                     |
| `@satorijs/element` → `@cordisjs/element` | ✅ 完成 | 同名 API，纯换 import（含 client vue 文件）                                             |
| 测试迁移                                  | ✅ 完成 | 143 tests / 18 files 全绿（新增 cqcode、lifecycle、types 测试）                         |
| 文档同步                                  | ✅ 完成 | 02/03/04/05/06/07/AGENTS 全部更新为 Nerve 时代                                          |

### 2.2 迁移里程碑时间线

```
vendor Satori v5 + capability-message（旧世界）
        │
        ├─ ① protocol 拆分：Body/NerveEvent/NerveService 基类（无 IM 语义）
        ├─ ② protocol-im：IM 实体 + IMBody + cordis.Events 声明
        ├─ ③ nerve-onebot：OneBot adapter 从 satori 基类改继承 IMBody
        ├─ ④ 依赖方迁移：cortex-chat / sandbox / sandbox-nerve
        └─ ⑤ 删除 vendor/ + capability-message，文档同步
        │
        ▼
自研 Nerve 协议（新世界）
```

**关键**：`protocol`（无 IM 语义）与 `protocol-im`（IM 增强）的拆分，让"删掉整个 vendored Satori"变成**纯增量替换**——没有一处需要反向迁移。协议层保持"只含类型契约 + 极薄基类"是值得坚持的方向。

---

## 3. 差异对照（Satori ↔ Nerve）

### 3.1 概念映射

| 概念         | Satori v5（旧）                                       | Nerve（新）                                                                            |
| ------------ | ----------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 协议包       | `@satorijs/core` + `@satorijs/protocol`（vendored）   | `@athena-ai/protocol` + `@athena-ai/protocol-im`                                       |
| 连接实例     | `Bot`（继承 Satori Bot 基类）                         | `Body`（抽象基类）/ `IMBody`（IM 默认实现）                                            |
| 注册表       | `ctx.satori.bots`（`Satori` service）                 | `ctx.nerve`（`NerveService`，`get(sid)` 寻址）                                         |
| 事件信封     | `Session`（含 `.type` / `.content` / `.bot` 访问器）  | `Session`（信封，IM 访问器由 `defineAccessor` 挂原型）+ 具体接口收窄                 |
| 事件发射     | `bot.dispatch(session)` → `internal/session` → 归一化 | `body.dispatch(session)` → `internal/session` → 归一化 → `emit(session.type, session)` |
| 事件类型     | `message` / `message-updated` / ...                   | `message-created` / `message-updated` / ...                                            |
| 事件声明     | `NerveEventMap`（我们加的，已删）                     | **只在 `cordis.Events` 声明一份**                                                      |
| 事件别名     | 无（Satori 直接按类型发射）                           | 无（`eventAliases` 已删除；`internal` 子事件按 `_type` 发射）                          |
| 富文本       | `@satorijs/element`（`h()`）                          | `@cordisjs/element`（`Element()`，protocol-im 提供 `at`/`quote`/`image` 工厂）         |
| 发送 API     | `ctx.message.createMessage(...)`（MessageService）    | `event.body.sendMessage(...)`（IMBody 方法）                                           |
| Internal API | Satori `InternalRouter`                               | 自研 `Internal` 类（interface 声明 + class 动态生成，koishi 模式）                     |
| 连接客户端   | Satori `WsClientBase`                                 | 自研 `WsClient`（protocol-im，双模式重连状态机）                                       |
| 平台 adapter | `adapter-onebot`（vendored）                          | `nerve-onebot`（自研）                                                                 |

### 3.2 API 迁移速查

| 旧写法（Satori）                          | 新写法（Nerve）                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------- |
| `ctx.satori.bots[sid]`                    | `ctx.nerve.get(sid)`                                                              |
| `bot.session(partial)`                    | `body.session(partial)`（同签名，`Session` 信封）                                  |
| `session.type = "message"`                | `session.type = "message-created"`                                                |
| `session.content`                         | `session.content`（访问器，从 `message.content` 推导）                            |
| `session.channelId!`                      | `session.channelId`（访问器，从 `channel.id` 推导）                               |
| `session.bot?.sid`                        | `session.body.sid`                                                                |
| `session.userId === session.selfId`       | `event.userId === event.selfId`                                                   |
| `ctx.message.createMessage(cid, content)` | `event.body.sendMessage(cid, content)`                                            |
| `ctx.on("message", ...)`                  | `ctx.on("message-created", ...)`                                                  |
| `import { h } from "@satorijs/element"`   | `import { Element } from "@cordisjs/element"` 或 protocol-im 的 `at`/`quote` 工厂 |
| `Universal.Channel.Type.DIRECT`           | `Channel.Type.DIRECT`（protocol-im）                                              |
| `ctx.plugin(Satori)`（capability 内部）   | 不需要 —— adapter 直接继承 `IMBody`                                               |

### 3.3 设计差异（不只是改名）

1. **运行时统一 Session 信封 + 类型层具体接口收窄（2026-08-25 修订）**
   - Satori：所有事件都是 `Session` 类，靠运行时属性访问器（`session.channelId` 等）从 `session.event` 推导
   - Nerve：`Session`（core 信封，`defineAccessor` 把 IM 访问器直接挂在 `Session.prototype` 上，satori 模式）+ 具体接口（`IMMessageEvent` 等 `extends Session` 收窄 `type` 与必填字段）
   - 收益：运行时统一传播载体 + 类型层精确接口兼得；adapter 只需填嵌套数据对象（`channel`/`user`/`guild`/`message`），派生字段由访问器推导
   - 与 Koishi 对齐：`message.content` = 元素序列化串（含 `at`/`face` 标签），`reply` 元素分离为 `message.quote`（异步拉取，失败时 undefined）

2. **事件作用域靠 cordis isolate，不靠 `[Context.filter]` 注入**
   - Satori 时代：MessageService 在 `internal/session` 上做 unwrap + filter 注入（约 30 行魔法）
   - Nerve 时代：`isolate: { life, cortex, nerve }` 由 group 声明，事件经 cordis 正常作用域投递，**无 filter 代码**

3. **发送走 `event.body`，不走全局 service**
   - 事件携带来源 Body 引用，Cortex 拿到即可回复，无需先寻址、无需 botSid 参数
   - 需要主动查询时才用 `ctx.nerve.get(sid)`

4. **能力检测：零 placeholder（satori 模式，2026-08-26 修订）**
   - `IMBody` 不提供任何 `_notImplemented` 占位实现；不支持的平台方法直接**不写在原型上**
   - 构造时 `features` 自动扫描（`Object.entries(Methods)` 过滤 `typeof this[name] === "function"`），`supports("message.get")` 判断能力
   - 缺失方法调用 = `TypeError: ... is not a function`，与 Satori 一致；调用前用 `supports()` 检测
   - `IMBody` 只强制抽象原语 `createMessage` / `createDirectChannel`；composite（`sendMessage`/`sendPrivateMessage`）由基类提供

5. **Internal API 数据驱动**
   - `Methods` 表（66 个方法）是单一事实来源，`Method()` 工厂声明参数名
   - `Internal.define(name, ...params)` 动态生成请求方法（koishi 模式）

---

## 4. 未来方向

### 4.1 近期（Nerve 生态补全）

| 方向                           | 说明                                                                   |
| ------------------------------ | ---------------------------------------------------------------------- |
| **QQ 官方 adapter**            | `adapter-qq` 未迁移；需要时按 `nerve-onebot` 模板自研（~500 行）       |
| **Discord / Telegram adapter** | Satori 生态有现成参考（`references/satori`），协议层可直接复用         |
| **更多 IM 事件**               | 当前覆盖 message/notice/request 主流事件；`guild-*`、`friend-*` 按需补 |
| **protocol-im 类型补全**       | `GuildRole` / `BidiList` 等类型已有定义，方法表可按需扩展              |

### 4.2 中期（协议层深化）

| 方向                      | 说明                                                                          |
| ------------------------- | ----------------------------------------------------------------------------- |
| **非 IM Nerve 的正式化**  | Minecraft / Live2D / Audio 等 `Body` 子类模式，目前只有 IMBody 参考           |
| **MessageEncoder 平台化** | protocol-im 已有基类；各 adapter 的平台编码器（如 OneBot CQCode）可抽公共工具 |
| **WsClient 复用**         | 双模式重连状态机已通用化，其他 WS 平台可直接复用                              |
| **Event 序列化 / 持久化** | NerveEvent 目前含非序列化 `body` 引用；message-store 落地时需要 wire 格式约定 |

### 4.3 远期（生态与工具）

| 方向                   | 说明                                                                              |
| ---------------------- | --------------------------------------------------------------------------------- |
| **Nerve 协议文档化**   | 作为独立协议对外发布（类比 Satori Protocol 文档）                                 |
| **adapter 测试工具包** | 平台 mock / 事件录制回放，降低新 adapter 开发成本                                 |
| **能力协商**           | Satori 有 `bot.features`；Nerve 可用 `Methods` 表 + `implements` 元数据实现等价物 |

---

## 5. 遗留问题

### 5.1 已知缺口（未解决）

| #   | 问题                                                                             | 影响面             | 备注                                                                    |
| --- | -------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------- |
| 1   | **`yarn test` 不跑项目测试**（yakumo-vitest workspace 作用域缺陷）               | 全仓库             | 已登记 P1；验证用 `npx vitest run`                                      |
| 2   | **`message-store` 是空占位**                                                     | Phase 3 消息持久化 | `src/index.ts` 只有 `export {}`                                         |
| 3   | **`sandbox-nerve` 的 `_createEvent` 返回 `Partial<IMEvent> & { type: string }`** | sandbox 事件       | 字段显式填充但类型是 partial，可再收紧（`session()` 已自动推导派生字段） |
| 4   | **`protocol-im` 的 `NerveEvent` 扩展字段用可选声明**                             | 类型安全           | `channelId` / `userId` 等可选，消费方要判空；未来可考虑具体事件接口收窄 |
| 5   | **provider 内建 tool 不经过 `ctx.ai`**                                           | AI 集成            | `register()` 只收 `ProviderV4`；内建 tool 挂 client 自有字段            |
| 6   | **`provider-anthropic` / `provider-google` 未迁移**                              | AI 生态            | 需时按 `provider-openai` 模板照抄（~30 行）                             |

### 5.2 决策遗留（挂在 spec 修订上）

| 项                                                                  | 状态                                                              |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `D-01`~`D-08`（Satori/Capability 架构决策）中部分"已实现"标注已过时 | 迁移后这些决策的**对象已不存在**，需重写或标注 SUPERSEDED         |
| `M-01`~`M-30`（capability-message / 多 Life 隔离决策）              | 部分决策对象已删除（capability-message）；隔离 key 从 4 个变 3 个 |
| `B-satori-primer.md`（附录 B）整篇描述 vendored Satori              | 对象已删除；**保留作历史参考**，新读者以本附录 + 代码为准         |

### 5.3 未验证的场景（迁移后未实测）

- **多 Life 真机隔离**：两个 Life 各挂一个 OneBot 账号同时在线（单元测试覆盖了隔离，未做真实平台双端验证）
- **断线重连**：WS 断连 → 自动重连 → 事件恢复（WsClient 状态机有测试，未做真实网络验证）
- **HTTP 长轮询模式**：OneBot HTTP 模式的完整收发链路（测试覆盖 WS 为主）
- **WS-reverse**：反向 WS 模式的 OneBot 实现（`http.ts` 已有，未与真实 OneBot 实现互通）

---

## 6. 相关文档索引

| 文档                                     | 内容                                       |
| ---------------------------------------- | ------------------------------------------ |
| [05](../05-lessons-learned.md) §14       | Satori → Nerve 迁移的踩坑记录（7 条）      |
| [04](../04-patterns-and-recipes.md) §3   | 定义 IM Body 的开发模式                    |
| [04](../04-patterns-and-recipes.md) §4   | 定义 Nerve 的开发模式                      |
| [02](../02-architecture.md) §7           | IM 事件契约与发送 API                      |
| [02](../02-architecture.md) §11          | Vendored 依赖（历史）移除记录              |
| [06](../06-progress-and-roadmap.md) §1.4 | vendor 移除记录                            |
| [B](./B-satori-primer.md)                | Satori v5 速查（**历史参考**，对象已删除） |
