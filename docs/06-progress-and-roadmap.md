# 当前进度与路线图

> 本文的进度信息基于对仓库的直接扫描（代码、package.json、测试运行结果），不依赖 `.specify/specs/` 的自述状态。
>
> 最后核验时间：2026-08-20。核验方式：`yarn workspaces list`、`npx vitest run`、逐包读源码。

---

## 1. 进度矩阵

### 1.1 packages/

| 包                    | 状态                  | 实现内容                                                                                                                                                                                                                                                       | 对应 spec |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `@athena-ai/core`     | ✅ 完成（有意最小化） | 空 `apply()` + 重导出 cordis / cosmokit / schemastery                                                                                                                                                                                                          | M-23      |
| `@athena-ai/protocol` | ✅ 完成               | `Persona` / `LifeService` / `MemoryProvider` / `SearchOptions` / `MemoryEntry`；Sandbox 契约（`MessageSink` / `SandboxDispatchPayload` / `SandboxNerveHandle` / `SandboxHubService`）；`Cortex` abstract class；`declare module "cordis"`（`life`、`sandbox`） | M-22      |
| `@athena-ai/ai`       | 🔸 部分（未接线）     | ModelService：provider 注册/注销、chat & embedding 模型解析、alias、defaults、JSON config 加载与告警收集（~567 行）。**未注册为 cordis Service**                                                                                                               | D-09      |

### 1.2 plugins/

| 包                                                 | 状态        | 实现内容                                                                                                                                                                                                   | 对应 spec             |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `@athena-ai/plugin-life`                           | ✅ 核心完成 | `ctx.life`；`persona` 解析（仅 inline）；`bind(cortex)` → disposer；`MemoryStub`（in-memory Map）                                                                                                          | M-16, M-25            |
| capability-message（`plugins/capability-message`） | ✅ 核心完成 | MessageService：`ctx.plugin(Satori)`、`bots` getter、`createMessage` / `sendMessage` / `sendPrivateMessage`、`_resolveBot` 寻址、`[Context.filter]` 事件作用域注入、cordis proxy unwrap                    | M-01(修订), M-02~M-05 |
| `@athena-ai/cortex-chat`                           | 🔸 骨架     | 继承 `Cortex`、`inject: ["life","message"]`、订阅 `message`、echo 回复（`[persona.name] Echo: content`）。**无 LLM、无 willingness、无缓冲**                                                               | D-29                  |
| `@athena-ai/plugin-sandbox`                        | ✅ 完成     | SandboxHub：`/sandbox` WebUI 页面、`/sandbox/file` 文件服务器（含 MIME 表）、WS 监听器、`register` / `lives` / `fileBase`、按 lifeId 路由、Vue 前端（layout / message / input / content / render / icons） | M-27~M-30             |
| `@athena-ai/sandbox-nerve`                         | ✅ 完成     | per-Life Nerve：向 Hub 注册、懒创建 `SandboxBot`、`dispatch` / `request` / `release`、`ctx.effect` 清理、message-deleted 隧道                                                                              | M-27~M-29             |
| message-store（`plugins/message-store`）           | ❌ 空壳     | 只有 package.json + tsconfig.json，`src/` 为空                                                                                                                                                             | —                     |

### 1.3 providers/

**这是一个未在 workspaces 中登记的目录**，内容是**尚未迁移的 YesImBot Koishi 插件**。

| 包                                           | 目录                  | 状态      | 问题                                                                                                          |
| -------------------------------------------- | --------------------- | --------- | ------------------------------------------------------------------------------------------------------------- |
| `@yesimbot/koishi-plugin-provider-openai`    | `providers/openai`    | ❌ 未迁移 | `import { Context, Schema } from "koishi"`；`ctx.yesimbot.model.register(...)`；依赖 `koishi-plugin-yesimbot` |
| `@yesimbot/koishi-plugin-provider-anthropic` | `providers/anthropic` | ❌ 未迁移 | 同上                                                                                                          |
| provider-google                              | `providers/google`    | ❌ 未迁移 | 同上（无测试）                                                                                                |
| provider-deepseek                            | `providers/deepseek`  | ❌ 未迁移 | 同上（无测试）                                                                                                |

`providers/*` 不在 `package.json` 的 `workspaces`（`packages/*`、`plugins/*`、`vendor/*/*`）中，因此其依赖（`@ai-sdk/openai`、`@ai-sdk/anthropic`）未被安装，测试直接失败。

### 1.4 vendor/

| 包                          | 状态                   | 备注                                                     |
| --------------------------- | ---------------------- | -------------------------------------------------------- |
| `@satorijs/core`            | ✅ vendored + 已打补丁 | 移除 `ctx.mixin`；`ctx.bots` → `ctx.satori.bots`（3 处） |
| `@satorijs/protocol`        | ✅ vendored            | 有测试（唯一被 `yarn test` 拾取的）                      |
| `@satorijs/element`         | ✅ vendored            | —                                                        |
| `@satorijs/adapter-satori`  | ✅ vendored            | Satori Protocol 客户端（Koishi bridge 用）               |
| `@athena-ai/adapter-onebot` | ✅ vendored + 已改名   | 从 `@satorijs/adapter-onebot` 改为 athena scope          |
| `@satorijs/adapter-qq`      | ✅ vendored + 已打补丁 | `ctx.bots` → `ctx.satori.bots`                           |
| `@cordisjs/url-is-local`    | ✅ vendored            | 辅助包                                                   |

### 1.5 尚未开始

| 项                                                                    | 说明                                            | 对应 spec |
| --------------------------------------------------------------------- | ----------------------------------------------- | --------- |
| `ctx.tools` Tool Registry                                             | 无对应 package                                  | D-16      |
| Hook Protocol 契约                                                    | `protocol` 中无 `Events` 声明                   | D-23      |
| AI SDK 集成到 Cortex                                                  | cortex-chat 中无 `generateText` / `streamText`  | D-09      |
| Memory 持久化                                                         | 仅 `MemoryStub`                                 | FR-008    |
| Persona 文件加载                                                      | `_resolvePersona` 对 string 输入直接抛错        | D-17      |
| `cortex-world` / `cortex-interlude`                                   | 无对应 package                                  | —         |
| `capability-minecraft` / `capability-audio` / `capability-expression` | 无对应 package                                  | D-07      |
| `instances/` / `personas/` / `cordis.yml` / `app.yml`                 | 仓库中不存在（部署配置在外部 boilerplate 仓库） | M-19      |
| Layer 3 tool 注册机制                                                 | 延后设计                                        | D-08      |
| Execution Record（可观测性）                                          | 未设计                                          | —         |

### 1.6 测试现状

`npx vitest run` 结果：**7 个测试文件通过（52 个测试），2 个失败**。

| 测试文件                                           | 状态                                         |
| -------------------------------------------------- | -------------------------------------------- |
| `packages/protocol/tests/cortex.test.ts`           | ✅                                           |
| `packages/protocol/tests/sandbox.test.ts`          | ✅                                           |
| `plugins/life/tests/life.test.ts`                  | ✅ 5 个用例                                  |
| `plugins/capability-message/tests/service.test.ts` | ✅ 8 个用例（含隔离与事件归属）              |
| `plugins/cortex-chat/tests/cortex-chat.test.ts`    | ✅ 4 个用例                                  |
| `plugins/sandbox/tests/sandbox.test.ts`            | ✅                                           |
| `plugins/sandbox-nerve/tests/nerve.test.ts`        | ✅                                           |
| `providers/openai/tests/index.test.ts`             | ❌ `Cannot find package '@ai-sdk/openai'`    |
| `providers/anthropic/tests/index.test.ts`          | ❌ `Cannot find package '@ai-sdk/anthropic'` |

`yarn test`（经 yakumo-vitest）只拾取到 `@satorijs/protocol` 一个文件 —— yakumo 的 workspace 作用域与 vitest 的文件发现不一致。**这是一个需要修的 tooling 缺口**：`yarn test` 当前不会跑 athena 自己的测试。

无覆盖率数据（未配置 coverage）。

---

## 2. Spec 与实现的偏差

以下偏差已核实。**权威顺序：代码 > 用户指示 > `docs/` > `.specify/specs/`。**

| #   | Spec 说法                                                                                                                          | 实际实现                                                                                                               | 裁定                                                                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 1   | `@athena-ai/core` 含 `Cortex` 基类 + 类型 + Hook 声明（`capability-message-design.md` Part XI / M-15）                             | 这些在 `@athena-ai/protocol`；core 是 re-export shell                                                                  | **代码为准**（M-22 / M-23 已修订 spec）                                             |
| 2   | `LifeService.registerCortex()` / `unregisterCortex()`                                                                              | `LifeService.bind(cortex): () => void`                                                                                 | **代码为准**（M-25）                                                                |
| 3   | MessageService 内部 `ctx.isolate('satori').isolate('bots')` 创建**私有**域，`ctx.satori` 对 Life ctx 不可见（M-01）                | MessageService 直接 `ctx.plugin(Satori)`；隔离由外层 group 的 `isolate: { satori: true }` 声明；satori 在 group 内可见 | **代码为准**（`multi-life-isolation-design.md` §5 已修订 M-01）                     |
| 4   | `capability-message` 无 `core` 依赖（M-17）                                                                                        | `package.json` 中 `@athena-ai/core` 在 devDependencies + peerDependencies（为了 `Schema`）                             | **偏差存在**，属可接受的类型级依赖；若要严格遵守 M-17，应改为直接依赖 `schemastery` |
| 5   | Cortex 通过 `inject` 声明依赖，不依赖 vendor 类型                                                                                  | `cortex-chat` 直接 `import { Session } from "@satorijs/core"`                                                          | **可接受**（类型级）；更干净的做法是由 capability 重导出 Satori 类型                |
| 6   | `pull-based` Sense Queue（`spirit-pulse-medium-domain-model.md` FR-004/005；`capability-protocol-and-entity-model.md` FR-004/005） | push-based，Cortex 自管理                                                                                              | **spec 已废弃**（D-05 / D-28）                                                      |
| 7   | Spirit / Pulse / Medium 命名                                                                                                       | Life / Cortex / Nerve                                                                                                  | **spec 已废弃**（D-20）                                                             |
| 8   | `capability-protocol-and-entity-model.md` 整篇                                                                                     | 整篇 SUPERSEDED                                                                                                        | 仅作历史参考                                                                        |
| 9   | `ctx.satori` / `ctx.bots` 可用（原 Satori 行为）                                                                                   | `ctx.bots` 不存在（mixin 已移除）                                                                                      | **代码为准**（M-21 / M-26）                                                         |
| 10  | `ctx.ai` 服务可用（`packages/ai` 的 `declare module`）                                                                             | `ModelService` 不 `extends Service`，无 provide key → `ctx.ai` 实际未注册                                              | **实现缺陷**，见 §3                                                                 |

---

## 3. 已确认的缺陷（优先修复）

### P0-1 · 包名与目录错位

`plugins/capability-message`（含 MessageService 实现）与 `plugins/message-store`（空壳）的 **package name 互换了**：

```
@athena-ai/plugin-message-store   ←  plugins/capability-message   ❌ 应为 @athena-ai/capability-message
@athena-ai/capability-message     ←  plugins/message-store        ❌ 应为 @athena-ai/plugin-message-store
```

**影响**：任何对 `@athena-ai/capability-message` 的真实模块解析都会命中空壳包。测试之所以通过，是因为 `vitest.config.ts` 的 alias 直接指向 `plugins/capability-message/src/index.ts`，绕过了包解析。构建产物与运行时部署会失败。

**附带问题**：两个 package.json 的 `cordis.service` 都写了 `"required": ["life"]`。capability 不应依赖 `life`（违反 M-17 与依赖倒置）—— 应删除。

**git 证据**：`plugins/capability-message/package.json` 的改名是**未提交的工作区改动** —— HEAD 中是正确的 `@athena-ai/capability-message`：

```console
$ git diff plugins/capability-message/package.json
-  "name": "@athena-ai/capability-message",
+  "name": "@athena-ai/plugin-message-store",
```

而 `plugins/message-store/` 整个目录是**未跟踪的新增**（`git status` 显示 `?? plugins/message-store/`）。合理推断：新建 message-store 时复制了 capability-message 的 package.json，随后把原包改名，方向弄反了。修复只需还原两个 `name`。

**修复**：交换两个 `name` 字段；从 capability-message 的 `cordis.service` 中移除 `required: ["life"]`。

### P0-2 · `ModelService` 未注册为 cordis Service

```typescript
// packages/ai/src/index.ts
declare module "cordis" {
  interface Context {
    ai: ModelService;      // ← 声明了
  }
}

export class ModelService {  // ← 但不 extends Service，无 provide key
  constructor(ctx: Context, config: ModelServiceConfig) {
    this.ctx = ctx;          // 手工存 ctx，未调 super(ctx, "ai")
  }
  *[Service.init]() { ... }   // 有 init generator
}
```

**影响**：`ctx.ai` 永远是 `undefined`。任何 Cortex 都无法解析模型 → AI 能力完全不可用。

**修复**：`class ModelService extends Service<ModelServiceConfig>` + `super(ctx, "ai")`，移除手工 `ctx` / `config` 字段。

### P1-1 · `yarn test` 不跑项目测试

`yarn test`（yakumo-vitest）只拾取 `@satorijs/protocol`；`npx vitest run` 才能跑全部。

**影响**：CI 与本地 `yarn test` 给出虚假的绿色。

**修复**：调查 yakumo-vitest 的包发现逻辑，或改 `test` script 为直接 `vitest run`。

### P1-2 · `providers/*` 未迁移且未登记

四个 provider 包仍是 Koishi 插件（`import from "koishi"`、`ctx.yesimbot.model`），且不在 workspaces 中 → 依赖未安装 → 2 个测试文件失败。

**修复**：见 Phase 2-A。短期可先从 vitest 的 `exclude` 中排除 `providers/**` 以恢复绿色。

### P2-1 · Logger 名残留 YesImBot

`packages/ai/src/index.ts` 用 `ctx.logger("yesimbot.model")`。应为 `"athena.model"`。

### P2-2 · vitest alias 缺项

`vitest.config.ts` 缺 `@athena-ai/plugin-life`（靠 workspace symlink 侥幸生效）与 `@athena-ai/ai`。新增包时容易踩。

### P2-3 · `legacy/` 未清理

`legacy/` 含 10 个被取代的包（`harness-core`、`athena-runtime`、`agent`、`agent-loop`、`session`、`tools`、`prompt`、`persist-jsonl`、`onebot-body`）。已在 git 历史中保留，可考虑删除以减少 AI agent 与新贡献者的误读风险。

### P2-4 · `packages/ai/src/index.ts` 未通过 oxfmt

`yarn format:check` 报该文件有格式问题（全仓库唯一一个）。因该目录整体未被 git 跟踪（`?? packages/ai/`），可能有人正在改动，未擅自格式化。接手时先跑 `yarn format`。

---

## 4. 路线图

### Phase 1 · 基础骨架 —— ✅ 已完成

**目标**：证明三原语可以在 Cordis v4 + Satori v5 上跑起来，且多 Life 隔离成立。

已完成：

- [x] Monorepo 结构（packages / plugins / vendor）+ yakumo 构建 + oxlint/oxfmt + husky
- [x] Satori v5 vendoring 与 mixin 补丁
- [x] `@athena-ai/protocol`：类型 + `Cortex` 基类 + module augmentation
- [x] `@athena-ai/plugin-life`：`ctx.life` + one-Cortex 强制
- [x] capability-message：Satori 隔离 + `ctx.message` + 事件作用域过滤
- [x] `@athena-ai/cortex-chat`：Cortex 骨架（echo）
- [x] Sandbox Hub + Nerve：无需真实 IM 即可验证对话链路
- [x] Multi-Life 隔离机制（`{ life, cortex, message, satori }`）验证
- [x] `@athena-ai/ai`：ModelService 逻辑主体

**验收状态**：52 个测试通过；多 Life 隔离的根因分析与方案已落地（`multi-life-isolation-design.md` 标记 Approved / Implemented）。

---

### Phase 2 · 核心认知循环

**顺序按用户确认**：AI 基础设施 → Hook 契约 → cortex-chat。

#### Phase 2-A · AI 基础设施（统一模型服务 + 工具注册表）

**目标**：Cortex 能拿到可用的 `LanguageModel` 和统一的 tool 集合。

任务：

1. **修 P0-1（包名错位）与 P0-2（ModelService 未注册）** —— 阻塞其余一切
2. **`ModelService` 接线为 cordis Service**
   - `extends Service<ModelServiceConfig>` + `super(ctx, "ai")`
   - logger 改 `"athena.model"`
   - 补 `packages/ai/tests/` —— provider 注册/注销、模型解析、alias、defaults、config 告警
   - `vitest.config.ts` 补 `@athena-ai/ai` alias
3. **迁移 `providers/*` 到 athena**
   - 登记 `providers/*` 进 `workspaces`
   - 改名 `@athena-ai/provider-<name>`
   - `import from "koishi"` → `cordis` + `@athena-ai/core`（`Schema`）
   - `ctx.yesimbot.model.register(...)` → `ctx.ai.register(...)`
   - `inject: ["yesimbot"]` → `inject: ["ai"]`
   - `ctx.on("ready")` / `ctx.on("dispose")` → `*[Service.init]()` + `yield dispose`
   - 至少让 deepseek + openai 两个可用
4. **新建 `@athena-ai/plugin-tools`（`ctx.tools`）**
   - `register(definition): () => void`
   - `available(): ToolDefinition[]` —— 沿 context 链向上遍历（local → life → global）
   - `execute(call, options?): Promise<ToolResult>` —— 统一执行入口，为将来的 guard/hook 留位
   - 作用域语义测试：root 注册的 tool 全局可见；Life group 注册的 tool 仅该 Life 可见；sibling group 不可见
   - 与 AI SDK `ToolSet` 的互转（`available()` 结果可直接 spread 进 `generateText({ tools })`）

**验收标准**：

- [ ] `yarn workspaces list` 中无包名/目录错位
- [ ] `ctx.ai` 在安装 `@athena-ai/ai` 后可用，`ctx.ai.resolveChatModel(id)` 返回可用的 AI SDK `LanguageModel`
- [ ] 至少两个 provider 以 athena 形态注册成功，`listChatModels()` 返回其模型
- [ ] `ctx.tools.available()` 的作用域行为有测试覆盖（含 sibling group 不可见）
- [ ] `yarn test` 能跑到全部 athena 测试且全绿（P1-1 修复）
- [ ] 一个最小脚本能完成：`new Context()` → 装 ai + provider → `resolveChatModel` → `generateText` 返回文本

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

- [ ] 五个 hook 在 `protocol` 中有类型声明
- [ ] 参考插件能通过 `before-enact` 否决一次发送，且有测试
- [ ] `after-integrate` 能向上下文注入内容，且有测试
- [ ] Cortex 不发射某 hook 时，监听该 hook 的插件不报错

#### Phase 2-C · cortex-chat LLM 集成

**目标**：第一个真正"会思考"的 Cortex。

任务：

1. **Rhythm** —— willingness engine：被 @、关键词、频率抑制等信号 → 分数；超阈值开聚合窗口
2. **缓冲** —— per-channel 队列 + 聚合窗口定时器 + per-channel 串行锁
3. **Integration** —— 组装 persona + 最近消息 + memory 检索结果
4. **Cognition** —— `generateText` 多步 tool-loop；模型来自 `ctx.ai.resolveChatModel(config.model)`
5. **Layer 2 tools** —— `send_message`、`wait`（"不回复"是一等决策）
6. **Layer 3 tools** —— spread `ctx.tools.available()`
7. **Enactment** —— 通过 `ctx.message.createMessage` 派发；无输出时静默
8. **发射 Hook** —— 按 2-B 的契约在五个点发射
9. **清理** —— `*[Service.init]()` 中 yield 定时器清理

**验收标准**：

- [ ] Sandbox 页面中发消息，Life 用 LLM 生成的内容回复（非 echo）
- [ ] 意愿不足时不回复，且有测试
- [ ] 聚合窗口内的多条消息合并为一次认知，且有测试
- [ ] 同一 channel 的并发消息不会重入认知循环，且有测试
- [ ] LLM 调用失败时 Cortex 不崩溃，仅 warn
- [ ] 多 Life 部署下 Alice 与 Bob 各自用自己的 persona 回复，事件不串台

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
| 16  | `legacy/` 是否删除                                             | 本文 §3 P2-3            |

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
