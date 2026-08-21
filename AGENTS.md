# AGENTS.md

athena-harness 的 AI agent 工作指南。**动手前先读本文，再按需展开 `docs/`。**

---

## 项目是什么

**Athena Harness** —— 数字生命（digital being）的运行时内核。让实体跨多个维度**持续存在**，而不只是被动响应消息。

三原语：

| Primitive  | 回答             | 职责                                                                  |
| ---------- | ---------------- | --------------------------------------------------------------------- |
| **Life**   | "我是谁？"       | 跨时间持续的身份：persona、memory、self-model                         |
| **Cortex** | "我如何活着？"   | 完整生存策略：rhythm、integration、cognition、enactment、continuation |
| **Nerve**  | "我存在于何处？" | 与世界的双向通道                                                      |

技术栈：**Cordis v4**（组合基座）+ **Satori v5**（vendored，IM）+ **AI SDK v7**（LLM）。

**不是** Koishi 的分支，**不打算**成为另一个 Koishi。共享砖块（cordis + satori），不同的组织原则。

---

## 优先级与权威顺序

冲突时按此裁定：

```
当前代码  >  用户最新指示  >  docs/  >  .specify/specs/
```

`.specify/specs/` 记录的是**设计演进过程**，含已被推翻的内容：

- `capability-protocol-and-entity-model.md` —— 整篇 **SUPERSEDED**
- `spirit-pulse-medium-domain-model.md` —— 概念有效，命名（Spirit/Pulse/Medium）与 pull-based Sense Queue 已废弃
- `capability-message-design.md` —— M-01 / M-05 / M-15 / M-17 / M-18 / M-20 已被修订

已知的 spec ↔ 代码偏差清单见 `docs/06-progress-and-roadmap.md` §2。

---

## 文档路由

**不要一次读完所有文档。** 按任务选入口：

| 任务                                       | 先读                                                                |
| ------------------------------------------ | ------------------------------------------------------------------- |
| 理解项目 / 首次接触                        | `docs/00-overview.md`                                               |
| 讨论架构、判断某设计是否合理               | `docs/01-design-philosophy.md`                                      |
| 改运行时拓扑、隔离、包依赖                 | `docs/02-architecture.md`                                           |
| **写任何代码前（必读）**                   | `docs/03-code-conventions.md`                                       |
| 新建 Service / Cortex / Nerve / Capability | `docs/04-patterns-and-recipes.md`                                   |
| 接 LLM / 配 provider / 写 `models.yml`     | `docs/04-patterns-and-recipes.md` §5 + `docs/02-architecture.md` §9 |
| **改动前避坑（强烈建议）**                 | `docs/05-lessons-learned.md`                                        |
| 确认进度、挑下一步任务                     | `docs/06-progress-and-roadmap.md`                                   |
| 查 Cordis API / 陷阱                       | `docs/appendix/A-cordis-primer.md`                                  |
| 查 Satori API / 我们的补丁                 | `docs/appendix/B-satori-primer.md`                                  |
| 查某条决策的出处                           | `docs/appendix/C-decision-index.md`                                 |

---

## 硬约束（不可违反）

违反这些会破坏架构。改动前逐条核对：

1. **Cortex 只通过 `ctx.message` 访问 IM** —— 永不 `ctx.satori`、永不 `ctx.bots`
2. **Cortex 依赖 `capability-*`，永不依赖 `nerve-*` / `adapter-*`**
3. **每个 Life 至多一个 Cortex** —— 由 `Life.bind()` 强制
4. **框架不提供 event→response 管道** —— 无 middleware chain、无 command routing
5. **Cortex 自管理事件缓冲** —— 框架不提供 queue / inbox / mailbox
6. **没有 Service 在构造函数调 `ctx.mixin()`** —— 全进程 accessor 名冲突
7. **Multi-Life 隔离 `{ life, cortex, message, satori }` 四个 key**
8. **不包装 Satori Bot / Session / Methods**
9. **不在 AI SDK 之上加 LLM 抽象层**
10. **Instance 机制只用 cordis 标准原语**（`plugin-include` + `plugin-group` + `isolate`）

### 退化测试

Athena 满足以下任一条即已退化成"又一个 Koishi"：

1. Life 只是 Cortex 启动时读一次的 config 文件
2. Cortex 只是个订阅事件的普通插件
3. 非 IM capability 是二等公民
4. 框架把 event→response 当核心流程
5. Memory / persona 是静态的

**任何改动如果推向上述任一条，必须先说明并征求确认。**

---

## 最常踩的坑

完整版见 `docs/05-lessons-learned.md` §13。高频项：

| 错误                                  | 正确做法                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ctx.bots`                            | `ctx.satori.bots`（domain 内）/ `ctx.message.bots`（Cortex 侧）。**类型上存在但运行时不存在** |
| `ctx.mixin()`                         | 不要用。全进程 accessor 名冲突，多 Life 直接崩                                                |
| `===` 比较 service                    | 按 `.name` 比较。cordis 用 Proxy 包装，identity 不可靠                                        |
| 依赖 `this.ctx` 解析 isolate          | 构造时自存 `this._self = ctx`                                                                 |
| 直读 `session.bot.ctx` 判归属         | 先 unwrap：`Symbol.for("cordis.original")`                                                    |
| `static optional = [...]`             | **cordis v4 没有这个。** 可选依赖用 `ctx.get(name)` 或 `ctx.inject([...], cb)`                |
| `session.stripped.appel`              | **Athena 没有。** 那是 Koishi 加料。自己查 `session.elements` 里的 `at` 元素                  |
| `waterfall` 当 reducer 用             | cordis v4 的 `waterfall` 是 `next()` 中间件链；调用方要给链尾 `inner`                         |
| `ctx.someService`（未 inject）        | 会抛错。用 `ctx.get("someService")`                                                           |
| `this.config` 在 Service 里           | **基类不提供。** 自己写 `constructor(ctx, public config: Config)`                             |
| `generateText({ maxSteps })`          | `ai@7` 没有。用 `stopWhen: stepCountIs(n)`                                                    |
| tool 的 `execute` 解构参数            | 用单个 `input`；解构 + 转发可选字段会破坏 TS 推导                                             |
| `models.yml` 里写 `maxTokens`         | AI SDK 的名字是 `maxOutputTokens`。写错会被 loader 丢掉并 warn，不会静默生效                  |
| 以为 provider 插件能配模型列表        | 不能。Config 只有 `id` / `apiKey` / `baseURL`，其余全在 `models.yml`（D-34）                  |
| 期待 `ctx.ai` 帮你重试                | 不会。`candidates()` 只给排好序的候选，failover 循环写在 Cortex 里（D-35）                    |
| 测试里 `await` inject 未满足的 plugin | 会永久挂住。不要 await，直接断言 `ctx.get(...)` 为 `undefined`                                |
| `cordis` 放 `dependencies`            | 必须 `peerDependencies`。多副本导致 Symbol 身份不同，隔离静默失效                             |
| 改 vendored 代码不登记                | 登记到 `docs/02-architecture.md` §11.3                                                        |
| 顺手格式化 `vendor/`                  | `vendor/` 被 oxfmt 忽略，保持上游格式                                                         |

---

## 代码规范速查

完整版：`docs/03-code-conventions.md`

### 格式

- **纯 ESM**，`"type": "module"`
- **双引号**、**必须分号**、`printWidth: 160`、`trailingComma: "all"`
- 新代码 import **省略扩展名**（`moduleResolution: "bundler"`）
- **不要手工调格式** —— 跑 `yarn format`
- 代码注释用**英文**，文档用**中文**（技术术语保留英文）

### Service

```typescript
declare module "cordis" {
  interface Context {
    myService: MyService;
  }
}

export default class MyService extends Service<Config> {
  static inject = ["life"];                    // 全部必需
  public static readonly Config: Schema<Config> = Schema.object({ ... });

  constructor(ctx: Context) {
    super(ctx, "myService");                   // ← 第二参数 = provide key
  }

  *[Service.init]() {
    const timer = setInterval(...);
    yield () => clearInterval(timer);          // fiber dispose 时自动执行
  }
}
```

- 构造函数中的 `ctx.on()` / `ctx.plugin()` **自动清理**，无需 yield disposer
- 只有外部资源（timer、socket、第三方注册）需要 yield
- **不要**自定义 `start()` / `stop()` / `dispose()`
- package.json 必须有 `cordis.service` 元数据（`implements` / `required`）

### 命名

| 种类             | 风格                                                                                   |
| ---------------- | -------------------------------------------------------------------------------------- |
| 类 / 接口 / 类型 | `PascalCase`                                                                           |
| 函数 / 变量      | `camelCase`                                                                            |
| 私有成员         | `_` 前缀                                                                               |
| 常量             | `SCREAMING_SNAKE`                                                                      |
| 文件             | `kebab-case.ts`，入口 `src/index.ts`                                                   |
| Cordis 事件      | `kebab-case`，`/` 分域                                                                 |
| 包               | `@athena-ai/{core,protocol,ai}` / `capability-*` / `cortex-*` / `nerve-*` / `plugin-*` |

### 错误与日志

```typescript
// 抛错带定位信息
throw new Error(`Bot not found: ${sid}`);
throw new Error(`Multiple bots available (${sids.join(", ")}); specify botSid`);

// 日志
this.ctx.logger("cortex-chat").warn("Failed to reply:", e);
```

- 配置错误 / 契约违反 → **抛**
- 单次外部操作失败 → **记日志**，不要杀掉 Cortex
- Cortex 的事件处理器**必须**包 try/catch
- 不要吞异常

---

## 命令

```bash
yarn install          # Yarn 4 workspaces
yarn build            # yakumo: tsc(.d.ts) → esbuild(JS) → client
yarn lint             # oxlint
yarn format           # oxfmt
npx vitest run        # ← 跑全部测试（yarn test 当前只拾取一个包，见下）
```

> ⚠️ **`yarn test` 目前不跑项目测试** —— yakumo-vitest 只拾取到 `@satorijs/protocol`。验证改动时**用 `npx vitest run`**。这是已登记的 P1 缺陷。

运行时（部署配置在外部 boilerplate 仓库）：

```bash
cordis run            # cordis.yml(prelude) → app.yml(managed tree)
```

---

## 仓库地图

```
packages/
  core/        @athena-ai/core       — prelude shell，重导出 cordis/cosmokit/Schema
  protocol/    @athena-ai/protocol   — 类型 + Cortex 基类 + declare module
  ai/          @athena-ai/ai         — AIService（ctx.ai：provider registry + models.yml + 模型解析）
plugins/
  life/                @athena-ai/plugin-life         — ctx.life
  capability-message/  @athena-ai/capability-message  — ctx.message（Satori 隔离）
  cortex-chat/         @athena-ai/cortex-chat         — ctx.cortex（当前仅 echo）
  sandbox/             @athena-ai/plugin-sandbox      — 全局 SandboxHub
  sandbox-nerve/       @athena-ai/sandbox-nerve       — per-Life Sandbox 桥
  provider-openai/     @athena-ai/provider-openai     — 注册 AI SDK OpenAI provider
  provider-deepseek/   @athena-ai/provider-deepseek   — 注册 AI SDK DeepSeek provider
  message-store/       @athena-ai/plugin-message-store — 占位（src 只有 export {}）
providers/     ❌ anthropic / google 仍是未迁移的 YesImBot Koishi 插件，不在 workspaces 中；openai / deepseek 已被 plugins/provider-* 取代
vendor/        satorijs/*（已打补丁）+ cordisjs/url-is-local
legacy/        被取代的旧包（10 个），可忽略
docs/          本文档体系
.specify/specs/ 设计演进记录
```

---

## 当前状态（2026-08-21 核验）

|           | 状态                                                                                                                                                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ✅ 完成   | `core`、`protocol`、`ai`（AIService）、`plugin-life`、`capability-message`、`plugin-sandbox`、`sandbox-nerve`、`provider-openai`、`provider-deepseek`；Satori vendoring + mixin 补丁；多 Life 隔离机制 |
| 🔸 部分   | `cortex-chat`（仅 echo 骨架，尚未接 AI SDK）                                                                                                                                                           |
| ❌ 未开始 | `ctx.tools`、Hook Protocol 契约、Cortex 侧 AI SDK 集成、Memory 持久化、Persona 文件加载、`cortex-world` / `cortex-interlude`、非 IM capability                                                         |
| 测试      | `npx vitest run` → 13 文件 121 用例全绿                                                                                                                                                                |

### Roadmap 顺序（已确认）

```
Phase 2-A  AI 基础设施   → ✅ AIService + provider 插件 ｜ ⬜ ctx.tools
Phase 2-B  Hook 契约     → protocol 中声明五个 hook + 参考插件验证
Phase 2-C  cortex-chat   → willingness + 缓冲 + generateText tool-loop + Layer 2 tools
Phase 3    完整数字生命  → Memory 持久化 + Persona 文件 + Instance 工作流 + 真实 IM
Phase 4    多形态扩展    → cortex-world + capability-minecraft + cortex-interlude
```

细节与验收标准见 `docs/06-progress-and-roadmap.md` §4。

---

## 工作方式

### 动手前

1. **读代码，不要凭 spec 假设** —— spec 有多处已过时
2. 涉及 Cordis 行为时**读 `references/cordis/packages/core/src/`** —— 不要凭印象
3. 新建 Service / Cortex / Nerve 时**先看 `docs/04-patterns-and-recipes.md`** 的对应 recipe
4. 改动前扫一眼 `docs/05-lessons-learned.md` §13 的速查表

### 验证

- **改完必须验证** —— 至少跑 `npx vitest run`；涉及构建的跑 `yarn build`
- 新增 Service 至少覆盖：安装后可见、inject 未满足时不激活、dispose 后释放、抛错路径、隔离正确性
- 新增 package 记得在 `vitest.config.ts` 补 alias
- **不 mock Cordis / Satori** —— 用真的 `new Context()`；只 fake 外部世界（浏览器、HTTP、平台）

### 参考代码（只读）

| 路径                                       | 用途                                   |
| ------------------------------------------ | -------------------------------------- |
| `references/cordis`                        | Cordis v4-beta 源码 —— 核验 API 与陷阱 |
| `references/satori`                        | Satori v5 main —— 对比我们的补丁       |
| `references/satori-v4`                     | Satori v4 stable —— 对比 API 演进      |
| `YesImBot/node_modules/@koishijs/core/src` | Koishi 核心 —— 学教训，**不照搬架构**  |

读参考代码时区分三类结论：**(a) 值得复用的模式**、**(b) 刻意不采纳的做法及原因**、**(c) 踩过的坑**。

### 同步文档

以下改动**必须**同步更新：

| 改动                            | 更新                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 新增/移除 package               | `docs/02-architecture.md` §2、`docs/06-progress-and-roadmap.md` §1                                     |
| 新增 Service / capability token | `docs/02-architecture.md` §6.1、`docs/04-patterns-and-recipes.md`                                      |
| 修改 vendored 代码              | `docs/02-architecture.md` §11.3、`docs/05-lessons-learned.md`                                          |
| 踩到新坑并解决                  | `docs/05-lessons-learned.md`（含速查表 §13）                                                           |
| 完成 roadmap 项                 | `docs/06-progress-and-roadmap.md` §4 勾选 + §1 矩阵                                                    |
| 修复缺陷                        | `docs/06-progress-and-roadmap.md` §3 移除                                                              |
| 新的设计决策                    | `.specify/specs/` + `docs/appendix/C-decision-index.md`（从 `D-37` / `M-31` 续号，跳过 `D-24`/`D-25`） |

### 沟通

- 讨论用**中文**，技术术语保留**英文**（Life、Cortex、Nerve、Service、inject、isolate、Context、Session…）
- 发现 spec 与代码冲突 → **明确指出**，以代码/用户指示为准
- 触及硬约束或退化测试 → **先说明再动手**

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
