# 当前进度与路线图

> 本文的进度信息基于对仓库的直接扫描（代码、package.json、测试运行结果），不依赖 `.specify/specs/` 的自述状态。
>
> 最后核验时间：2026-08-20。核验方式：`yarn workspaces list`、`npx vitest run`、逐包读源码。

---

## 1. 进度矩阵

### 1.1 packages/

| 包                       | 状态                  | 实现内容                                                                                                                                                                                                                              | 对应 spec                                |
| ------------------------ | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| `@athena-ai/core`        | ✅ 完成（有意最小化） | 空 `apply()` + 重导出 cordis / cosmokit / schemastery                                                                                                                                                                                 | M-23                                     |
| `@athena-ai/protocol`    | ✅ 完成               | `Body` / `NerveEvent` / `NerveService`（`ctx.nerve`）及既有 Persona / LifeService / MemoryProvider / Sandbox 契约、`Cortex` abstract class                                                                                            | M-22；2026-08-25 Nerve Protocol & OneBot |
| `@athena-ai/protocol-im` | ✅ 完成               | IM 协议扩展：Message / Channel / User 等实体类型、`Body` 方法与 IM 事件的 declaration merging、MessageEncoder 基类                                                                                                                    | 2026-08-25 Nerve Protocol & OneBot       |
| `@athena-ai/ai`          | ✅ 完成               | `AIService`（provides `ai`，root 级全局单例）：Provider Registry、`models.yml` 加载与校验、六个模态的解析、`defaultSettingsMiddleware` 注入、`candidates()` / `ModelGroup` / 断路器 / 三种策略、`default()` / `metadata()` / `list()` | D-33~D-35                                |

### 1.2 plugins/

| 包                                                 | 状态        | 实现内容                                                                                                                                                                                                   | 对应 spec                          |
| -------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| `@athena-ai/plugin-life`                           | ✅ 核心完成 | `ctx.life`；`persona` 解析（仅 inline）；`bind(cortex)` → disposer；`MemoryStub`（in-memory Map）                                                                                                          | M-16, M-25                         |
| capability-message（`plugins/capability-message`） | ✅ 核心完成 | MessageService：`ctx.plugin(Satori)`、`bots` getter、`createMessage` / `sendMessage` / `sendPrivateMessage`、`_resolveBot` 寻址、`[Context.filter]` 事件作用域注入、cordis proxy unwrap                    | M-01(修订), M-02~M-05              |
| `@athena-ai/cortex-chat`                           | 🔸 骨架     | 继承 `Cortex`、`inject: ["life","message"]`、订阅 `message`、echo 回复（`[persona.name] Echo: content`）。**无 LLM、无 willingness、无缓冲**                                                               | D-29                               |
| `@athena-ai/plugin-sandbox`                        | ✅ 完成     | SandboxHub：`/sandbox` WebUI 页面、`/sandbox/file` 文件服务器（含 MIME 表）、WS 监听器、`register` / `lives` / `fileBase`、按 lifeId 路由、Vue 前端（layout / message / input / content / render / icons） | M-27~M-30                          |
| `@athena-ai/sandbox-nerve`                         | ✅ 完成     | per-Life Nerve：向 Hub 注册、懒创建 `SandboxBot`、`dispatch` / `request` / `release`、`ctx.effect` 清理、message-deleted 隧道                                                                              | M-27~M-29                          |
| `@athena-ai/provider-openai`                       | ✅ 完成     | `createOpenAI()` → `ctx.ai.register(config.id, provider)`；`reusable`（官方 key + 内部网关可共存）；`ctx.effect` 注销                                                                                      | D-34                               |
| `@athena-ai/provider-deepseek`                     | ✅ 完成     | 同上，`createDeepSeek()`                                                                                                                                                                                   | D-34                               |
| `@athena-ai/nerve-onebot`                          | ✅ 完成     | OneBot v11 消息接收适配、Element → CQ 编码、Body 生命周期与有限 IM API                                                                                                                                     | 2026-08-25 Nerve Protocol & OneBot |
| `@athena-ai/plugin-message-store`                  | ❌ 占位     | `src/index.ts` 只有 `export {}` + 说明注释（占位以免 tsc 报 "No inputs were found"）；Phase 3 消息持久化用                                                                                                 | —                                  |

### 1.3 providers/

**这是一个未在 workspaces 中登记的目录**，内容是**尚未迁移的 YesImBot Koishi 插件**，保留作对照参考。`vitest.config.ts` 已 `exclude: ["providers/**"]`。

| 包                                           | 目录                  | 状态                                     | 备注                                              |
| -------------------------------------------- | --------------------- | ---------------------------------------- | ------------------------------------------------- |
| `@yesimbot/koishi-plugin-provider-openai`    | `providers/openai`    | ⏹️ 已被 `plugins/provider-openai` 取代   | 旧设计把模型表/format/webSearch 塞进前端表单      |
| `@yesimbot/koishi-plugin-provider-anthropic` | `providers/anthropic` | ❌ 未迁移                                | 需要时按 `provider-openai` 模板照抄即可（~30 行） |
| provider-google                              | `providers/google`    | ❌ 未迁移                                | 同上                                              |
| provider-deepseek                            | `providers/deepseek`  | ⏹️ 已被 `plugins/provider-deepseek` 取代 | —                                                 |

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

| 项                                                                    | 说明                                                                  | 对应 spec |
| --------------------------------------------------------------------- | --------------------------------------------------------------------- | --------- |
| `ctx.tools` Tool Registry                                             | 无对应 package                                                        | D-16      |
| Hook Protocol 契约                                                    | `protocol` 中无 `Events` 声明                                         | D-23      |
| AI SDK 集成到 Cortex                                                  | cortex-chat 中无 `generateText` / `streamText`（`ctx.ai` 本身已可用） | D-09      |
| Memory 持久化                                                         | 仅 `MemoryStub`                                                       | FR-008    |
| Persona 文件加载                                                      | `_resolvePersona` 对 string 输入直接抛错                              | D-17      |
| `cortex-world` / `cortex-interlude`                                   | 无对应 package                                                        | —         |
| `capability-minecraft` / `capability-audio` / `capability-expression` | 无对应 package                                                        | D-07      |
| `instances/` / `personas/` / `cordis.yml` / `app.yml`                 | 仓库中不存在（部署配置在外部 boilerplate 仓库）                       | M-19      |
| Layer 3 tool 注册机制                                                 | 延后设计                                                              | D-08      |
| Execution Record（可观测性）                                          | 未设计                                                                | —         |

### 1.6 测试现状

`npx vitest run` 结果：**13 个测试文件全部通过（121 个测试）**。

| 测试文件                                           | 状态                                                                 |
| -------------------------------------------------- | -------------------------------------------------------------------- |
| `packages/ai/tests/config.spec.ts`                 | ✅ 16 个用例（`models.yml` 加载 / 校验 / 降级）                      |
| `packages/ai/tests/service.spec.ts`                | ✅ 24 个用例（注册、各模态解析、alias/defaults、strict、middleware） |
| `packages/ai/tests/group.spec.ts`                  | ✅ 16 个用例（断路器、candidates 三路径、三种策略、降级行为）        |
| `packages/ai/tests/integration.spec.ts`            | ✅ 7 个用例（真实 provider 插件 + models.yml 端到端，无网络）        |
| `packages/protocol/tests/cortex.spec.ts`           | ✅                                                                   |
| `packages/protocol/tests/sandbox.spec.ts`          | ✅                                                                   |
| `plugins/life/tests/life.spec.ts`                  | ✅ 5 个用例                                                          |
| `plugins/capability-message/tests/service.spec.ts` | ✅ 8 个用例（含隔离与事件归属）                                      |
| `plugins/cortex-chat/tests/cortex-chat.spec.ts`    | ✅ 4 个用例                                                          |
| `plugins/sandbox/tests/sandbox.spec.ts`            | ✅                                                                   |
| `plugins/sandbox-nerve/tests/nerve.spec.ts`        | ✅                                                                   |
| `plugins/provider-openai/tests/provider.spec.ts`   | ✅ 4 个用例（注册、注销、多实例、ID 重复失败）                       |
| `plugins/provider-deepseek/tests/provider.spec.ts` | ✅ 2 个用例                                                          |

`yarn test`（经 yakumo-vitest）只拾取到 `@satorijs/protocol` 一个文件 —— yakumo 的 workspace 作用域与 vitest 的文件发现不一致。**这是一个需要修的 tooling 缺口**：`yarn test` 当前不会跑 athena 自己的测试，验证改动请用 `npx vitest run`。

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
| 10  | `ctx.ai` 服务可用（`packages/ai` 的 `declare module`）                                                                             | ✅ 已修复 —— `AIService extends Service` + `super(ctx, "ai")`                                                          | **已解决**（D-33，见 §3 已修复表）                                                  |

---

## 3. 已确认的缺陷（优先修复）

### P1-1 · `yarn test` 不跑项目测试

`yarn test`（yakumo-vitest）只拾取 `@satorijs/protocol`；`npx vitest run` 才能跑全部。

**影响**：CI 与本地 `yarn test` 给出虚假的绿色。

**修复**：调查 yakumo-vitest 的包发现逻辑，或改 `test` script 为直接 `vitest run`。

### P1-2 · `providers/*` 未迁移（部分）

`providers/anthropic`、`providers/google` 仍是 Koishi 插件（`import from "koishi"`、`ctx.yesimbot.model`），且不在 workspaces 中。`vitest.config.ts` 已 `exclude: ["providers/**"]`，不影响测试。

**修复**：按 `plugins/provider-openai` 模板重建（约 30 行），然后删掉 `providers/`。

### P2-2 · `plugins/message-store` 是纯占位

`src/index.ts` 只有 `export {}`，仅为让 tsc 有输入（否则 `yarn build` 报 "No inputs were found"）。package.json 仍带 satori 依赖。Phase 3 动它之前，它是死重量。

### 已修复（保留记录）

| 编号 | 问题                                                         | 结果                                                                                                                                |
| ---- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| P0-1 | capability-message / message-store 包名互换                  | ✅ `name` 已还原；capability-message 的 `cordis.service.required: ["life"]` 已删；message-store 的伪 `implements: ["message"]` 已删 |
| P0-2 | `ModelService` 未 `extends Service`，`ctx.ai` 永远 undefined | ✅ `packages/ai` 已按 `.specify/specs/model-service-design.md` 重写为 `AIService extends Service`（provide key `ai`）               |
| P2-x | Logger 名残留 `yesimbot.model`                               | ✅ 随重写消失，现为 `ctx.logger("ai")`                                                                                              |
| P2-x | vitest alias 缺项                                            | ✅ 已不适用 —— `vitest.config.ts` 不用 alias，测试走相对路径引 src                                                                  |
| P2-x | `packages/ai/src/index.ts` 未过 oxfmt                        | ✅ 随重写消失，`yarn format` 全绿                                                                                                   |

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
- [x] `@athena-ai/ai`：早期 `ModelService` 逻辑主体（Phase 2-A 已按 D-33~D-35 整体重写为 `AIService`）

**验收状态**：52 个测试通过；多 Life 隔离的根因分析与方案已落地（`multi-life-isolation-design.md` 标记 Approved / Implemented）。

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
4. **新建 `@athena-ai/plugin-tools`（`ctx.tools`）** —— ⬜ 未开始
   - `register(definition): () => void`
   - `available(): ToolDefinition[]` —— 沿 context 链向上遍历（local → life → global）
   - `execute(call, options?): Promise<ToolResult>` —— 统一执行入口，为将来的 guard/hook 留位
   - 作用域语义测试：root 注册的 tool 全局可见；Life group 注册的 tool 仅该 Life 可见；sibling group 不可见
   - 与 AI SDK `ToolSet` 的互转（`available()` 结果可直接 spread 进 `generateText({ tools })`）

**验收标准**：

- [x] `yarn workspaces list` 中无包名/目录错位
- [x] `ctx.ai` 在安装 `@athena-ai/ai` 后可用，`ctx.ai.language(id)` 返回可用的 AI SDK `LanguageModelV4`
- [x] 至少两个 provider 以 athena 形态注册成功，`ctx.ai.providers()` / `list()` 返回其内容
- [x] `ctx.ai.candidates("main")` 返回按策略排序、已跳过断路器的 `Candidate[]`
- [ ] `ctx.tools.available()` 的作用域行为有测试覆盖（含 sibling group 不可见）
- [ ] `yarn test` 能跑到全部 athena 测试且全绿（P1-1 修复）
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
4. **Cognition** —— `generateText` 多步 tool-loop；模型来自 `ctx.ai.candidates(config.model)`，failover 循环写在 Cortex 里
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
