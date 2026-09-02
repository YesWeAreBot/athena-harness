# 当前进度与路线图

> 本文的进度信息基于对仓库的直接扫描（代码、package.json、测试运行结果），不依赖 `.specify/specs/` 的自述状态。
>
> 最后核验时间：2026-08-28。核验方式：`yarn test`（41 files / 353 tests）、`yarn clean && yarn build`、`yarn lint`、逐包读源码。

---

## 1. 进度矩阵

### 1.1 packages/

| 包                       | 状态                  | 实现内容                                                                                                                                                                                                                              | 对应 spec                                |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@athena-ai/core`        | ✅ 完成（有意最小化） | root 级安装 `ToolRegistry` 与 `AIService`，重导出 cordis / cosmokit / schemastery；不拥有任何 Life-scoped service                                                                                                                     | M-23                                     |
| `@athena-ai/protocol`    | ✅ 完成               | `Body` / `Session` / `NerveService`；`LifeService` 在每个 Life 域安装并拥有 NerveService，提供 fail-fast 隔离契约；既有 Hook / Cortex / Sandbox 契约                                                                                  | M-22；2026-08-25 Nerve Protocol & OneBot |
| `@athena-ai/protocol-im` | ✅ 完成               | IM 协议扩展：Message / Channel / User 等实体类型、`Body` 方法与 IM 事件的 declaration merging、MessageEncoder 基类                                                                                                                    | 2026-08-25 Nerve Protocol & OneBot       |
| `@athena-ai/ai`          | ✅ 完成               | `AIService`（provides `ai`，root 级全局单例）：Provider Registry、`models.yml` 加载与校验、六个模态的解析、`defaultSettingsMiddleware` 注入、`candidates()` / `ModelGroup` / 断路器 / 三种策略、`default()` / `metadata()` / `list()` | D-33~D-35                                |

### 1.2 plugins/

| 包                                 | 状态        | 实现内容                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | 对应 spec                          |
| ---------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `@athena-ai/plugin-life`           | ✅ 核心完成 | `ctx.life`（id / persona / dataDir）；`bind(cortex)`；继承 protocol LifeService 后与同 Life fiber 一并提供并释放 `ctx.nerve`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | M-16, M-25                         |
| ~~capability-message~~             | ❌ 已删除   | 2026-08-25 Satori → Nerve 迁移中整包删除（`ctx.message` 由 `cordis.Events` + `event.body` 替代）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | 2026-08-25 Nerve Protocol & OneBot |
| `@athena-ai/cortex-chat`           | ✅ 核心完成 | Life-scoped 主心智，三区内容老化管线：**稳定区**（constitution + persona + compaction）+ **帧区**（checkpoint v2 结构化 Frame：focus / history / lastFocusHistory）+ **工作区**（内存 `ModelMessage[]`，不跨进程持久化）。内部 message-store 客观档案；scene 作为寻址原语（`SceneAddress` / `SceneCursor`），无 per-scene 认知分区。`Attention`（frameFocus / logicalFocus 分离、direct/@self trigger 路由）；core tools（`send_message` / `wait` / `switch_focus` / `peek_channel`）；`TurnCoordinator`（串行 turn + join + aggregate + 重建事务：prune → 单次压缩 → checkpoint save → 清空工作区）；AI SDK v7 自管 step 循环（每 step 一次 `generateText`）；代码剪枝（reasoning 剔除、tool 对合并、失败原文保留、大输出首尾保留）；checkpoint v2 原子写、旧版本直接抛错 | D-29                               |
| `@athena-ai/plugin-sandbox`        | ✅ 完成     | SandboxHub + SandboxBot（IMBody 实现）：`/sandbox` WebUI 页面、`/sandbox/file` 文件服务器（含 MIME 表）、WS 监听器、`register` / `lives` / `fileBase`、按 lifeId 路由、Vue 前端（layout / message / input / content / render / icons）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | M-27~M-30                          |
| `@athena-ai/sandbox-nerve`         | ✅ 完成     | per-Life Nerve：向 Hub 注册、懒创建 `SandboxBot`、`dispatch` / `request` / `release`、`ctx.effect` 清理、message-deleted 隧道；`ctx.nerve.get()` 寻址                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | M-27~M-29                          |
| `@athena-ai/provider-openai`       | ✅ 完成     | `createOpenAI()` → `ctx.ai.register(config.id, provider)`；`reusable`（官方 key + 内部网关可共存）；`ctx.effect` 注销                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | D-34                               |
| `@athena-ai/provider-deepseek`     | ✅ 完成     | 同上，`createDeepSeek()`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | D-34                               |
| `@athena-ai/nerve-onebot`          | ✅ 完成     | OneBot v11 完整 adapter（IMBody 实现）：事件适配、CQCode、MessageEncoder、Internal API 动态生成、WS/WS-reverse/HTTP 三模式、自动连接生命周期                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | 2026-08-25 Nerve Protocol & OneBot |
| `@athena-ai/plugin-content-filter` | ✅ 完成     | Hook Protocol 参考插件：`before-enact` 按配置内容结构化否决行动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | D-23                               |
| `@athena-ai/plugin-message-store`  | ❌ 占位     | `src/index.ts` 只有 `export {}` + 说明注释（占位以免 tsc 报 "No inputs were found"）；Phase 3 消息持久化用                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | —                                  |

### 1.3 providers/

**这是一个未在 workspaces 中登记的目录**，内容是**尚未迁移的 YesImBot Koishi 插件**，保留作对照参考。`vitest.config.ts` 已 `exclude: ["providers/**"]`。

| 包                                           | 目录                  | 状态                                     | 备注                                              |
| -------------------------------------------- | --------------------- | ---------------------------------------- | ------------------------------------------------- |
| `@yesimbot/koishi-plugin-provider-openai`    | `providers/openai`    | ⏹️ 已被 `plugins/provider-openai` 取代   | 旧设计把模型表/format/webSearch 塞进前端表单      |
| `@yesimbot/koishi-plugin-provider-anthropic` | `providers/anthropic` | ❌ 未迁移                                | 需要时按 `provider-openai` 模板照抄即可（~30 行） |
| provider-google                              | `providers/google`    | ❌ 未迁移                                | 同上                                              |
| provider-deepseek                            | `providers/deepseek`  | ⏹️ 已被 `plugins/provider-deepseek` 取代 | —                                                 |

### 1.4 vendor/（已移除）

**2026-08-25 已整体删除**。Satori → Nerve 迁移完成后，vendored Satori（core / protocol / element / adapter-*）不再需要：

| 曾 vendored 的包           | 去向                                          |
| -------------------------- | --------------------------------------------- |
| `@satorijs/core`           | 由 `@athena-ai/protocol` + `protocol-im` 替代 |
| `@satorijs/protocol`       | 类型并入 `@athena-ai/protocol-im`             |
| `@satorijs/element`        | 用 npm 的 `@cordisjs/element`                 |
| `@satorijs/adapter-onebot` | 由 `@athena-ai/nerve-onebot` 替代             |
| `@satorijs/adapter-qq`     | 未迁移（QQ 官方 adapter 待自研）              |
| `@satorijs/adapter-satori` | 不需要（Satori 协议服务端）                   |
| `@cordisjs/url-is-local`   | 不再需要                                      |

### 1.5 尚未开始

| 项                                                                    | 说明                                                   | 对应 spec |
| --------------------------------------------------------------------- | ------------------------------------------------------ | --------- |
| `ctx.tools` Tool Registry                                             | 无对应 package                                         | D-16      |
| ~~AI SDK 集成到 Cortex~~                                              | ✅ 已完成（cortex-chat 自管 `generateText` step 循环） | D-09      |
| Memory 持久化                                                         | 仅 `MemoryStub`                                        | FR-008    |
| Persona 文件加载                                                      | `_resolvePersona` 对 string 输入直接抛错               | D-17      |
| `cortex-world` / `cortex-interlude`                                   | 无对应 package                                         | —         |
| `capability-minecraft` / `capability-audio` / `capability-expression` | 无对应 package                                         | D-07      |
| `instances/` / `personas/` / `cordis.yml` / `app.yml`                 | 仓库中不存在（部署配置在外部 boilerplate 仓库）        | M-19      |
| Layer 3 tool 注册机制                                                 | 延后设计                                               | D-08      |
| Execution Record（可观测性）                                          | 未设计                                                 | —         |

### 1.6 测试现状

`yarn test` 结果：**41 个测试文件全部通过（317 个测试）**，连续多次运行稳定。下表列出主要测试文件，未全部展开。

| 测试文件                                              | 状态                                                                                                                                                                 |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/ai/tests/config.spec.ts`                    | ✅ 16 个用例（`models.yml` 加载 / 校验 / 降级）                                                                                                                      |
| `packages/ai/tests/service.spec.ts`                   | ✅ 24 个用例（注册、各模态解析、alias/defaults、strict、middleware）                                                                                                 |
| `packages/ai/tests/group.spec.ts`                     | ✅ 16 个用例（断路器、candidates 三路径、三种策略、降级行为）                                                                                                        |
| `packages/ai/tests/integration.spec.ts`               | ✅ 7 个用例（真实 provider 插件 + models.yml 端到端，无网络）                                                                                                        |
| `packages/core/tests/tools.spec.ts`                   | ✅ 9 个用例（ToolRegistry root / Life / 兄弟作用域可见性）                                                                                                           |
| `packages/protocol/tests/nerve.spec.ts`               | ✅ 6 个用例（Body 注册、sid 寻址、Session 信封）                                                                                                                     |
| `packages/protocol/tests/life.spec.ts`                | ✅ 10 个用例（dataDir、多 Life 目录、Life-owned NerveService、同 sid 分域、独立释放、错误配置 fail-fast）                                                            |
| `packages/protocol/tests/cortex.spec.ts`              | ✅ 4 个用例（one-Cortex-per-Life 绑定）                                                                                                                              |
| `packages/protocol/tests/hooks.spec.ts`               | ✅ 8 个用例（Hook 契约 waterfall / bail / parallel / 未发射场景）                                                                                                    |
| `packages/protocol-im/tests/types.spec.ts`            | ✅ 14 个用例（IMBody 默认实现、组合方法、Methods 表、事件接口）                                                                                                      |
| `plugins/cortex-chat/tests/*`（21 个文件）            | ✅ 133 个用例（Scene / 归档 / workspace / checkpoint v2 / prompt / render / prune / tools / runner / pipeline / 生命周期 / **真实双 Life sandbox / 恢复 / 全链路**） |
| `plugins/sandbox/tests/sandbox.spec.ts`               | ✅ 20 个用例（Hub 路由、Bot 生命周期、入站 elements、出站 send 事件、Messenger、request 关联）                                                                       |
| `plugins/sandbox-nerve/tests/nerve.spec.ts`           | ✅ 6 个用例（Hub 注册、dispatch、delete 隧道、释放）                                                                                                                 |
| `plugins/nerve-onebot/tests/*`（5 个文件）            | ✅ 34 个用例（事件适配、CQCode round-trip、普通/forward/file canonical send、Internal API、生命周期）                                                                |
| `plugins/provider-openai/tests/provider.spec.ts`      | ✅ 4 个用例（注册、注销、多实例、ID 重复失败）                                                                                                                       |
| `plugins/provider-deepseek/tests/provider.spec.ts`    | ✅ 2 个用例                                                                                                                                                          |
| `plugins/content-filter/tests/content-filter.spec.ts` | ✅ 4 个用例（before-enact 否决 / 放行 / dispose / 静默）                                                                                                             |

多 Life / 恢复 / 全链路覆盖在 2026-08-28 补齐；本轮继续用真实部署拓扑关闭 Life/Nerve 所有权、OneBot outbound canonical 与无消费者 fingerprint 三个缺陷（见 §3 已修复表）。

无覆盖率数据（未配置 coverage）。

> **2026-08-29 文档整理**：`docs/plans/` 目录已删除，其内容已转述进现有文档体系——cortex-chat 三区管线、重建事务、剪枝规格、checkpoint v2、scene 寻址/认知界限沉淀在 cookbook 01/02/03/04；执行历史中的关键缺陷与修复保留在本文件 §3 已修复表；AI SDK 踩坑记录保留在 [05-lessons-learned](./05-lessons-learned.md) §15（含自管循环修订说明）。过程性执行日志（Task 编号、commit hash）不保留。

---

## 2. Spec 与实现的偏差

以下偏差已核实。**权威顺序：代码 > 用户指示 > `docs/` > `.specify/specs/`。**

| #   | Spec 说法                                                                                                                          | 实际实现                                                                                                                | 裁定                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 1   | `@athena-ai/core` 含 `Cortex` 基类 + 类型 + Hook 声明（`capability-message-design.md` Part XI / M-15）                             | 这些在 `@athena-ai/protocol`；core 是 re-export shell                                                                   | **代码为准**（M-22 / M-23 已修订 spec）        |
| 2   | `LifeService.registerCortex()` / `unregisterCortex()`                                                                              | `LifeService.bind(cortex): () => void`                                                                                  | **代码为准**（M-25）                           |
| 3   | 旧 spec 仍描述 MessageService / Satori 私有域                                                                                      | capability-message 与 vendored Satori 已删除；当前是 Life-owned NerveService + group `isolate: { life, cortex, nerve }` | **旧 spec 已 superseded；代码与 docs/02 为准** |
| 4   | `@athena-ai/core` 是无 service 的空 shell（M-23）                                                                                  | core 安装 root ToolRegistry / AIService；Life-scoped NerveService 由 protocol LifeService 安装                          | **当前代码为准**                               |
| 5   | Cortex 直接依赖 Satori Session                                                                                                     | Cortex 消费 protocol-im 的 `IMMessageEvent`，adapter 通过 protocol Body/Session 边界接入                                | **迁移已完成**                                 |
| 6   | `pull-based` Sense Queue（`spirit-pulse-medium-domain-model.md` FR-004/005；`capability-protocol-and-entity-model.md` FR-004/005） | push-based，Cortex 自管理                                                                                               | **spec 已废弃**（D-05 / D-28）                 |
| 7   | Spirit / Pulse / Medium 命名                                                                                                       | Life / Cortex / Nerve                                                                                                   | **spec 已废弃**（D-20）                        |
| 8   | `capability-protocol-and-entity-model.md` 整篇                                                                                     | 整篇 SUPERSEDED                                                                                                         | 仅作历史参考                                   |
| 9   | `ctx.satori` / `ctx.bots` 可用（原 Satori 行为）                                                                                   | `ctx.bots` 不存在（mixin 已移除）                                                                                       | **代码为准**（M-21 / M-26）                    |
| 10  | `ctx.ai` 服务可用（`packages/ai` 的 `declare module`）                                                                             | ✅ 已修复 —— `AIService extends Service` + `super(ctx, "ai")`                                                           | **已解决**（D-33，见 §3 已修复表）             |

---

## 3. 已确认的缺陷（优先修复）

### P1-2 · `providers/*` 未迁移（部分）

`providers/anthropic`、`providers/google` 仍是 Koishi 插件（`import from "koishi"`、`ctx.yesimbot.model`），且不在 workspaces 中。`vitest.config.ts` 已 `exclude: ["providers/**"]`，不影响测试。

**修复**：按 `plugins/provider-openai` 模板重建（约 30 行），然后删掉 `providers/`。

### P2-2 · `plugins/message-store` 是纯占位

`src/index.ts` 只有 `export {}`，仅为让 tsc 有输入（否则 `yarn build` 报 "No inputs were found"）。package.json 仍带 satori 依赖。Phase 3 动它之前，它是死重量。

### P2-3 · anti-slop 规则全部关闭

`oxlint.config.ts` 把 15 条 `anti-slop/*` 规则整段注释掉。2026-08-28 实测全开后有 **452 条**：263 `require-safety-comment-for-type-assertion`、82 `no-chained-type-assertions`、37 `no-runtime-typeof`、22 `no-unsafe-dictionary-type`、19 `no-known-value-widening`、12 `no-unknown-parameters`、8 `no-unknown-returns`、8 `no-conditional-empty-object-spread`、1 `no-object-parameters`。

**分布**：`plugins/cortex-chat/src/tools.ts`（87）、`src/message-store.ts`（54）、`tests/workspace-codec.spec.ts`（39）、`tests/message-store.spec.ts`（33）、`tests/tools.spec.ts`（28）为主。

**修复**：按文件分批清理，先修真正的类型安全问题——`CheckpointStore` / `MessageStore` / `SceneSessionStore` 读 `ctx.life` 用的 `as unknown as` 链式断言可以直接删掉（`WorkspaceStore` 已经直接读 `ctx.life`）。规则应在清理完一批后逐条打开，而不是一次全开。

### 已修复（保留记录）

| 编号 | 问题                                                         | 结果                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | capability-message / message-store 包名互换                  | ✅ `name` 已还原；capability-message 的 `cordis.service.required: ["life"]` 已删；message-store 的伪 `implements: ["message"]` 已删                                                                                                                                               |
| P0-2 | `ModelService` 未 `extends Service`，`ctx.ai` 永远 undefined | ✅ `packages/ai` 已按 `.specify/specs/model-service-design.md` 重写为 `AIService extends Service`（provide key `ai`）                                                                                                                                                             |
| P0-3 | Nerve 事件跨 Life 泄漏                                       | ✅ 先由 `3e173fe` 增加 owning-domain check 与 `Session[Context.filter]`；本轮再把 NerveService 所有权从 root core 移入 protocol LifeService。真实双 Life sandbox 测试证明只有目标 Life 调用模型/回复/归档，漏配 `nerve` isolate 时第二个 Life fail fast                           |
| P0-4 | sandbox adapter 只产出一半 IM event                          | ✅ `4df5015` —— 入站补 `elements`（否则 `isAtSelf()` 恒 false）、出站 dispatch `send`；入站归一化收敛到 `SandboxBot.receive()`                                                                                                                                                    |
| P1-3 | OneBot 出站归档内容为空                                      | ✅ encoder 同步维护 OneBot CQ segment 与 canonical Athena Element segment；普通、forward、file 三条分支统一 dispatch 非空 `content/elements`，返回 Message 与事件同源                                                                                                             |
| P1-6 | `stableFingerprint` 无消费者                                 | ✅ 从 PromptSnapshot / Checkpoint / runner 删除；version 1 loader 容忍并丢弃旧额外字段。persona、compaction 与 tool payload 每 turn 直接按当前状态重装配，不丢弃 checkpoint                                                                                                       |
| P1-1 | `yarn test` 不跑项目测试                                     | ✅ 已不复现 —— `yarn test`（yakumo vitest）现在跑全部 41 个文件 / 353 个测试                                                                                                                                                                                                      |
| P2-x | Logger 名残留 `yesimbot.model`                               | ✅ 随重写消失，现为 `ctx.logger("ai")`                                                                                                                                                                                                                                            |
| P1-4 | 干净树 `yarn build` 失败（sandbox-nerve 早于 sandbox 编译）  | ✅ 2026-08-28 —— `plugins/sandbox-nerve` 只把 `@athena-ai/plugin-sandbox` 声明为 peerDependency，yakumo 因此没有排序依据，在 sandbox 的 `lib/*.d.ts` 存在之前就编译它（`TS2307` + 6 个 `Context` 属性缺失）。补上镜像 peers 的 devDependencies 后 `yarn clean && yarn build` 通过 |
| P1-5 | cortex-chat 未声明 `@cordisjs/element` 依赖                  | ✅ 2026-08-28 —— esbuild 报 `Missing dependency`；改为经 `@athena-ai/protocol-im` 引入 `parse` 与 element 类型（protocol-im 已 re-export），不新增依赖                                                                                                                            |
| P2-x | vitest alias 缺项                                            | ✅ 已重新引入 —— `vitest.config.ts` 把 protocol / protocol-im / nerve-onebot / sandbox / sandbox-nerve 指向 src，避免跨包 import 落到过期的 `lib/` 而出现两份同名类                                                                                                               |
| P2-x | `packages/ai/src/index.ts` 未过 oxfmt                        | ✅ 随重写消失                                                                                                                                                                                                                                                                     |

---

## 4. 路线图

### Phase 1 · 基础骨架 —— ✅ 已完成

**目标**：证明三原语可以在 Cordis v4 上运行，且多 Life 的 service、事件与持久化边界成立。

已完成：

- [x] Monorepo 结构（packages / plugins）+ yakumo 构建 + oxlint/oxfmt + husky
- [x] 自研 `@athena-ai/protocol` / `protocol-im`，vendored Satori 与 capability-message 已删除
- [x] `@athena-ai/plugin-life`：`ctx.life` + one-Cortex 强制 + Life-owned `ctx.nerve`
- [x] `@athena-ai/cortex-chat`：真实 AI SDK turn loop、持久化、compaction、恢复
- [x] Sandbox Hub + per-Life Nerve：无需真实 IM 即可验证完整对话链路
- [x] Multi-Life 隔离机制（`{ life, cortex, nerve }`）与真实双 Life sandbox 验证
- [x] root AIService / ToolRegistry 与 Life-scoped tool 可见性

**验收状态**以本文件 §1.4 与最新全量验证为准；早期 52-test / Satori 基线仅保留在 git 历史。

---

### Phase 2 · 核心认知循环

**顺序按用户确认**：AI 基础设施 → Hook 契约 → cortex-chat。

#### Phase 2-A · AI 基础设施（统一模型服务 + 工具注册表）

**目标**：Cortex 能拿到可用的 `LanguageModel` 和统一的 tool 集合。

任务：

1. ~~**修 P0-1（包名错位）与 P0-2（ModelService 未注册）**~~ —— ✅ 完成
2. ~~**`AIService` 接线为 cordis Service**~~ —— ✅ 完成（`.specify/specs/model-service-design.md`）
   - `AIService extends Service<AIServiceConfig>` + `super(ctx, "ai")`，root 级全局单例（**不进**隔离集合）
   - `models.yml` 加载与校验；六个模态的 resolve；`defaultSettingsMiddleware` 注入 per-provider / per-model defaults
   - `candidates()` / `group()` / `ModelGroup` / 断路器 / `failover`·`round-robin`·`random`
   - `packages/ai/tests/` 63 个用例（config 16 / service 24 / group 16 / integration 7）
3. ~~**Provider 插件**~~ —— ✅ `plugins/provider-openai`、`plugins/provider-deepseek`（各带测试）
   - `reusable = true`；Config 只有 `id` / `apiKey` / `baseURL`
   - `createXxx()` → `ctx.ai.register(config.id, provider)` → `ctx.effect(() => dispose)`
   - 剩余：`anthropic` / `google` 按同模板补（见 P1-2）
4. ~~**`ctx.tools` ToolRegistry**~~ —— ✅ 完成（在 `packages/core/src/tools.ts`，未单独开 `plugin-tools` 包）
   - `register(name, tool): () => void`，Cordis dispose 自动注销
   - `available(): ToolSet` —— 按 caller context 判定作用域：root 注册全局可见，Life 组内注册仅该 Life 可见，兄弟组不可见
   - 直接返回 AI SDK `ToolSet`，可 spread 进 `streamText({ tools })`；无独立 `execute()` 入口（执行由 AI SDK 负责，guard 留给 Hook 契约）
   - `packages/core/tests/tools.spec.ts` 9 个用例覆盖三层作用域

**验收标准**：

- [x] `yarn workspaces list` 中无包名/目录错位
- [x] `ctx.ai` 在安装 `@athena-ai/ai` 后可用，`ctx.ai.language(id)` 返回可用的 AI SDK `LanguageModelV4`
- [x] 至少两个 provider 以 athena 形态注册成功，`ctx.ai.providers()` / `list()` 返回其内容
- [x] `ctx.ai.candidates("main")` 返回按策略排序、已跳过断路器的 `Candidate[]`
- [x] `ctx.tools.available()` 的作用域行为有测试覆盖（含 sibling group 不可见）
- [x] `yarn test` 能跑到全部 athena 测试且全绿（40 files / 351 tests）
- [ ] 一个最小脚本能完成：`new Context()` → 装 ai + provider → `ctx.ai.language()` → `generateText` 返回真实文本（需真实 API key，尚未做端到端）

#### Phase 2-B · Hook 契约

**目标**：社区插件能在不理解 Cortex 内部循环的前提下扩展其行为。

任务：

1. **在 `@athena-ai/protocol` 声明 Hook 契约**
   - `declare module "cordis" { interface Events { ... } }`
   - 五个 hook 及其 dispatch 模式：`cortex/before-drain`（waterfall）、`cortex/after-integrate`（waterfall）、`cortex/before-cognition`（waterfall）、`cortex/before-enact`（bail）、`cortex/after-enact`（parallel）
   - 定义各 hook 的载荷类型（不要用 `any`）
2. **确定载荷类型的抽象层级** —— 这是设计难点：hook 载荷要足够通用以覆盖三种 Cortex，又要足够具体以让插件能实际操作。建议先只为 Reactive 形态定型，World / Interlude 形态出现后再泛化。
3. **文档化"约定优于强制"** —— Cortex 可选择发射子集；插件监听未发射的 hook 时静默无效
4. **写一个参考插件**验证机制（如 `plugin-content-filter` 用 `before-enact` bail 拦截）

**验收标准**：

- [x] 五个 hook 在 `protocol` 中有类型声明
- [x] 参考插件能通过 `before-enact` 否决一次发送，且有测试
- [x] `after-integrate` 能向上下文注入内容，且有测试
- [x] Cortex 不发射某 hook 时，监听该 hook 的插件不报错

#### Phase 2-C · cortex-chat 核心认知循环 —— ✅ 已完成

**目标**：第一个真正"会思考"的 Cortex。

实现经 2026-08-27 迁移（Task 1–17）与 2026-08-28 三区管线重设计（Phase A–G）两个阶段落地：

1. **Scene 身份** —— `bodySid + channelId`（不是 `platform:channelId`：一个 Life 可有多个同平台 Body）；scene 是**寻址原语**，不是认知分区
2. **message-store** —— cortex-chat 内部模块，无条件归档 `message-created` 与 `send`，只存 canonical `content: string`，行上带内部 `lifeId`
3. ~~SceneSessionStore~~ —— 已删除：压缩器输入是整个帧区（`history` + `lastFocusHistory` + 上一版压缩条目），固定单次 LLM 调用，无 per-scene 分组
4. **workspace + checkpoint** —— 工作区是内存 `ModelMessage[]`（不跨进程持久化，AI SDK `result.response.messages` 原样追加）；checkpoint v2 原子写（focus / history / lastFocusHistory / compaction），路径在 `ctx.life.dataDir` 下，旧版本文件直接抛错
5. **Attention** —— frame focus 与 logical focus 分离；awareness 为工作区 delta（无累加器）；trigger 规则为 direct message 或 `@self`
6. **Core tools** —— `send_message` / `wait` / `switch_focus` / `peek_channel`，目标解析到唯一 Body，失败结构化返回、绝不伪造成功 id；与 `ctx.tools.available()` 合并，同名冲突抛错
7. **TurnCoordinator** —— 串行 turn ownership、聚合窗口、joined 消息在 step 边界进入、`interrupt` / `stop`、重建事务 owner（prune → 单次压缩 → checkpoint save → 成功后清空工作区）
8. **AI SDK v7 runner** —— 自管 step 循环（每 step 一次 `generateText`），整条存 `result.response.messages`，pending delta 在 response 之后追加；terminal 判定（`wait`、非 continue 的 `send_message`）
9. **compaction + 剪枝** —— 纯代码剪枝（reasoning 剔除、tool 对合并为一行、失败原文保留、大输出首尾保留）；压缩器单次调用，`previousCompaction` 可替换语义；失败保留工作区与旧 checkpoint

**未做（有意留后）**：完整 willingness scoring（当前只有 direct / `@self` / 否则等待）、第二条"反射弧"认知路径、Life Memory 持久化。

**验收状态**：

- [x] Sandbox 页面中发消息，Life 经由完整链路回复（`e2e-integration.spec.ts` 驱动真实 Hub + Nerve + bot，模型为脚本化 fake；真实 API key 的端到端仍未跑）
- [x] 不满足 trigger 时不回复，且有测试（focus 内普通消息进 workspace 不起 turn；非 focus 普通消息只归档）
- [x] 聚合窗口内的多条消息合并为一次认知，且有测试
- [x] 同一 Scene 的并发消息不会重入认知循环，且有测试（joined / queued admission）
- [x] LLM 调用失败时 turn 以 `failed` 结束、Cortex 不崩溃，且有测试
- [x] 多 Life 部署下事件与持久化不串台，且有测试（`isolation.spec.ts`；这条覆盖直接暴露了 P0-3）

---

### Phase 3 · 完整数字生命

**目标**：让 Life 真正"持续存在" —— 记忆持久化、身份可配置、可部署。

任务：

1. **Memory 持久化**
   - `MemoryProvider` 的 sqlite 实现（替换 `MemoryStub`）
   - 通过 `@cordisjs/plugin-database-sqlite` 接入
   - `store` / `retrieve` / `search`（先关键词，后向量）
   - 跨进程重启的身份连续性验证
2. **Persona 文件加载**
   - `Life._resolvePersona` 支持 YAML 文件路径
   - `personas/` 目录约定
3. **Instance 工作流**
   - `cordis.yml` / `app.yml` / `instances/` / `personas/` / `data/` 目录落地
   - `plugin-include` + `plugin-group` 的完整部署样例
   - HMR watch list 覆盖 `instances/`
4. **真实 IM 接入**
   - 路线 A：`adapter-satori` 桥接现有 Koishi 实例（`@koishijs/plugin-server`）
   - 路线 B：直接用 vendored `@athena-ai/adapter-onebot`
   - 两条路线各跑通一次
5. **Self-model 雏形** —— Life 持有可演化的状态（"我今天很累"），Cortex 在 integration 时读取、在 enactment 后更新
6. **Layer 3 tool 机制**（解冻 D-08）—— adapter 特定 tool 的注册、启用控制、作用域过滤

**验收标准**：

- [ ] 进程重启后 Life 的 memory 与 persona 恢复
- [ ] `instances/alice.yml` 可复制到另一部署并直接工作
- [ ] 在真实 IM 平台（QQ 或 Discord）完成一次对话
- [ ] 多 Life 部署在真实平台上各自使用不同账号
- [ ] Life memory 在多轮交互后可观察到累积（非人工写入）
- [ ] 一个 onebot 特有 tool（如 `set_essence`）能被 LLM 发现并调用

---

### Phase 4 · 多形态扩展

**目标**：证明框架不偏爱任何一种 Cortex 形态 —— 这是"不退化"的最终验收。

任务：

1. **`@athena-ai/cortex-world`** —— Continuous 形态
   - 永续 heartbeat（无外部事件也跳）
   - Mailbox 缓冲 + "手机"隐喻整合
   - 每拍一次 tool-call
   - `wait` 作为一等动作
2. **`@athena-ai/capability-minecraft`** —— 第二个 capability
   - 验证 capability 模式可复用（含 Hub + Nerve 拆分，若需要）
   - 与 `message` 平权：World Cortex 同时消费两者
3. **`@athena-ai/cortex-interlude`** —— Narrative 形态
   - Debounce 缓冲
   - `generateObject` 单次结构化输出
   - Story-DB 状态变更
4. **无 messaging 运行验证** —— 装 World Cortex + minecraft，**不装** capability-message，进程正常运行
5. **Execution Record** —— 框架级可观测性，捕获自主认知周期（含无外部事件触发的 cycle）
6. **退化测试形式化** —— 把 [01-design-philosophy.md](./01-design-philosophy.md) §8 的判据写成自动化测试

**验收标准**（对应设计理念的五条成功判据）：

- [ ] World Cortex（持续 heartbeat）与 Chat Cortex 一样自然工作
- [ ] 更换 Cortex 包改变认知策略，Life memory 完整保留
- [ ] Minecraft 事件与 IM 消息通过**完全相同**的机制被消费（`ctx.on`）
- [ ] 一个 Life 数小时不收消息仍在演化、记忆、偶尔行动
- [ ] Life memory 可验证地演化，无人工干预
- [ ] 进程中不含 Satori 时框架正常运行

---

## 5. 未决问题汇总

来自各 spec 的 Open Questions，实现时不要擅自锁定。

### 5.1 设计层

| #   | 问题                                                              | 出处              |
| --- | ----------------------------------------------------------------- | ----------------- |
| 1   | Life memory 基础设施的确切形态（vector DB / structured / hybrid） | design-philosophy |
| 2   | Self-model 的表示与演化机制                                       | design-philosophy |
| 3   | Cortex 契约接口规范（Cortex 必须向框架提供什么）                  | design-philosophy |
| 4   | 框架级可观测性（Execution Record）如何捕获自主认知周期            | design-philosophy |
| 5   | "退化测试"是否应形式化为验收测试                                  | design-philosophy |
| 6   | Hook 载荷类型的抽象层级（够通用又够具体）                         | 本文 Phase 2-B    |

### 5.2 工具模型

| #   | 问题                                                                                                                | 出处                   |
| --- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| 7   | Bot 归属强制：框架是否应阻止 Life A 使用 Life B 的 bot？（isolate 已提供跨 Life 物理隔离，同 Life 内多 bot 无约束） | tech-selection         |
| 8   | Tool 描述动态化：`ctx.tools` 是否支持根据当前状态生成描述（如列出可用 bot/channel）                                 | tech-selection         |
| 9   | `ctx.tools` 需要哪些执行前/后 hook（日志？限流？权限？）                                                            | tech-selection         |
| 10  | 插件 tool 命名是否命名空间化（`onebot.set_essence`）还是扁平                                                        | tech-selection         |
| 11  | Layer 3 tool 的注册与可见性控制机制                                                                                 | satori-capability D-08 |

### 5.3 运行时与运维

| #   | 问题                                                           | 出处                    |
| --- | -------------------------------------------------------------- | ----------------------- |
| 12  | 多 Life 共享同一个 Bot 实例（两个 Life 用一个 QQ 账号）        | capability-message      |
| 13  | Adapter config 热重载：改配置后重启 adapter？利用 cordis HMR？ | capability-message      |
| 14  | Satori v5 vendor 维护流程：如何追踪上游变更并选择性合并        | tech-selection          |
| 15  | Cortex Preset（内部行为风格动态切换）的形态                    | naming-and-package D-19 |

---

## 6. 如何更新本文

改动落地后**同步更新**：

| 改动                  | 更新位置                                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| 完成一个 roadmap 任务 | 勾选对应 checkbox；必要时更新 §1 进度矩阵                                                            |
| 新增/删除 package     | §1 对应表格                                                                                          |
| 发现 spec 与实现冲突  | §2 偏差表                                                                                            |
| 发现缺陷              | §3，按 P0/P1/P2 分级                                                                                 |
| 修复缺陷              | 从 §3 移除，必要时在 [05-lessons-learned.md](./05-lessons-learned.md) 记录教训                       |
| 解决未决问题          | §5 移除；决策记入 `.specify/specs/` + [appendix/C-decision-index.md](./appendix/C-decision-index.md) |

核验进度时**不要**只读本文 —— 跑一遍：

```bash
yarn workspaces list          # 包清单与名称
npx vitest run                # 真实测试状态
yarn build                    # 构建是否通过
```
