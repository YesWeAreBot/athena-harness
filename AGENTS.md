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

技术栈：**Cordis v4**（组合基座）+ **自研 Nerve 协议**（protocol + protocol-im，IM）+ **AI SDK v7**（LLM）。

**不是** Koishi 的分支，**不打算**成为另一个 Koishi。组合基座与 Koishi 共享（cordis），IM 协议层自研，不同的组织原则。

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

**新 spec 规约**：

- 必须使用 `.specify/templates/spec-template.md` 模板
- 使用**英文**撰写
- 已有中文 spec 为历史记录，不做回改

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
| 查 Satori → Nerve 迁移 / 新旧差异 / 遗留   | `docs/appendix/D-satori-to-nerve-migration.md`                      |
| 查 Satori API（历史参考，已移除）          | `docs/appendix/B-satori-primer.md`                                  |
| 查某条决策的出处                           | `docs/appendix/C-decision-index.md`                                 |
| 非技术读者通俗读物                         | `docs/07-athena-harness-book.md`                                    |

---

## 最常踩的坑

完整版见 `docs/05-lessons-learned.md` §13。高频项：

| 错误                                           | 正确做法                                                                                                       |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `ctx.bots` / `ctx.satori.bots` / `ctx.message` | **已不存在**（Satori 与 capability-message 已移除）。用 `ctx.nerve.get(sid)` 寻址、订阅 `cordis.Events` 收事件 |
| `ctx.mixin()`                                  | 不要用。全进程 accessor 名冲突，多 Life 直接崩                                                                 |
| `===` 比较 service                             | 按 `.name` 比较。cordis 用 Proxy 包装，identity 不可靠                                                         |
| 依赖 `this.ctx` 解析 isolate                   | 构造时自存 `this._self = ctx`                                                                                  |
| 直读 `session.bot.ctx` 判归属                  | 先 unwrap：`Symbol.for("cordis.original")`                                                                     |
| `static optional = [...]`                      | **cordis v4 没有这个。** 可选依赖用 `ctx.get(name)` 或 `ctx.inject([...], cb)`                                 |
| `session.stripped.appel`                       | **Athena 没有。** 那是 Koishi 加料。自己查 `session.elements` 里的 `at` 元素                                   |
| `waterfall` 当 reducer 用                      | cordis v4 的 `waterfall` 是 `next()` 中间件链；调用方要给链尾 `inner`                                          |
| `ctx.someService`（未 inject）                 | 会抛错。用 `ctx.get("someService")`                                                                            |
| `this.config` 在 Service 里                    | **基类不提供。** 自己写 `constructor(ctx, public config: Config)`                                              |
| `generateText({ maxSteps })`                   | `ai@7` 没有。用 `stopWhen: stepCountIs(n)`                                                                     |
| tool 的 `execute` 解构参数                     | 用单个 `input`；解构 + 转发可选字段会破坏 TS 推导                                                              |
| `models.yml` 里写 `maxTokens`                  | AI SDK 的名字是 `maxOutputTokens`。写错会被 loader 丢掉并 warn，不会静默生效                                   |
| 以为 provider 插件能配模型列表                 | 不能。Config 只有 `id` / `apiKey` / `baseURL`，其余全在 `models.yml`（D-34）                                   |
| 期待 `ctx.ai` 帮你重试                         | 不会。`candidates()` 只给排好序的候选，failover 循环写在 Cortex 里（D-35）                                     |
| 测试里 `await` inject 未满足的 plugin          | 会永久挂住。不要 await，直接断言 `ctx.get(...)` 为 `undefined`                                                 |
| `cordis` 放 `dependencies`                     | 必须 `peerDependencies`。多副本导致 Symbol 身份不同，隔离静默失效                                              |
| 维护平行事件注册表（NerveEventMap）            | 事件签名只在 `cordis.Events` 声明一份（satori/koishi 模式），见 `docs/05-lessons-learned.md` §14.2             |
| 在 `*[Service.init]()` 里 `yield` promise      | 会抛 `Invalid effect`。异步启动用 fire-and-forget，见 `docs/05-lessons-learned.md` §14.1                       |

---

## 代码规范速查

完整版：`docs/03-code-conventions.md`

### 格式

- **纯 ESM**，`"type": "module"`
- **双引号**、**必须分号**、`printWidth: 160`、`trailingComma: "all"`
- import **必须添加扩展名**（src 内用 `.js`，跨包用相对路径直接导入源文件）
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

> ⚠️ **`yarn test` 目前不跑项目测试** —— yakumo-vitest 有 workspace 作用域问题。验证改动时**用 `npx vitest run`**。这是已登记的 P1 缺陷。

运行时（部署配置在外部 boilerplate 仓库）：

```bash
cordis run            # cordis.yml(prelude) → app.yml(managed tree)
```

---

## 仓库地图

```
packages/
  core/        @athena-ai/core       — prelude shell，重导出 cordis/cosmokit/Schema
  protocol/    @athena-ai/protocol   — Nerve 核心：Body 基类 + Session 信封 + NerveService + Cortex
  protocol-im/ @athena-ai/protocol-im — IM 协议层：实体类型、Methods 表、事件、MessageEncoder、WsClient
  ai/          @athena-ai/ai         — AIService（ctx.ai：provider registry + models.yml + 模型解析）
plugins/
  life/                @athena-ai/plugin-life              — ctx.life
  cortex-chat/         @athena-ai/plugin-cortex-chat        — ctx.cortex（当前仅 echo）
  nerve-onebot/        @athena-ai/plugin-nerve-onebot       — OneBot v11 adapter（IMBody 实现）
  sandbox/             @athena-ai/plugin-sandbox            — 全局 SandboxHub + SandboxBot（IMBody 实现）
  sandbox-nerve/       @athena-ai/plugin-sandbox-nerve      — per-Life Sandbox 桥
  provider-openai/     @athena-ai/plugin-provider-openai    — 注册 AI SDK OpenAI provider
  provider-deepseek/   @athena-ai/plugin-provider-deepseek  — 注册 AI SDK DeepSeek provider
  provider-anthropic/  @athena-ai/plugin-provider-anthropic — 注册 AI SDK Anthropic provider
  provider-google/     @athena-ai/plugin-provider-google    — 注册 AI SDK Google provider
  message-store/       @athena-ai/plugin-message-store      — 占位（src 只有 export {}）
docs/          本文档体系
.specify/specs/ 设计演进记录
```

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

| 路径                   | 用途                                   |
| ---------------------- | -------------------------------------- |
| `references/cordis`    | Cordis v4-beta 源码 —— 核验 API 与陷阱 |
| `references/satori`    | Satori v5 main —— 对比我们的补丁       |
| `references/satori-v4` | Satori v4 stable —— 对比 API 演进      |
| `references/koishi`    | Koishi 核心 —— 学教训，**不照搬架构**  |

读参考代码时区分三类结论：**(a) 值得复用的模式**、**(b) 刻意不采纳的做法及原因**、**(c) 踩过的坑**。

### 同步文档

以下改动**必须**同步更新：

| 改动                            | 更新                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------ |
| 新增/移除 package               | `docs/02-architecture.md` §2、`docs/06-progress-and-roadmap.md` §1             |
| 新增 Service / capability token | `docs/02-architecture.md` §6.1、`docs/04-patterns-and-recipes.md`              |
| 新增/修改 IM 事件或方法         | `protocol-im` 的 `cordis.Events` 声明 + `docs/04-patterns-and-recipes.md` §3.3 |
| 踩到新坑并解决                  | `docs/05-lessons-learned.md`（含速查表 §13）                                   |
| 完成 roadmap 项                 | `docs/06-progress-and-roadmap.md` §4 勾选 + §1 矩阵                            |
| 修复缺陷                        | `docs/06-progress-and-roadmap.md` §3 移除                                      |
| 新的设计决策                    | `.specify/specs/` + `docs/appendix/C-decision-index.md`                        |

### 沟通

- 讨论用**中文**，技术术语保留**英文**（Life、Cortex、Nerve、Service、inject、isolate、Context、Session…）
- 发现 spec 与代码冲突 → **明确指出**，以代码/用户指示为准
- 触及硬约束或退化测试 → **先说明再动手**

---

## 长期记忆（retain / recall / reflect）

Agent 拥有跨会话持久记忆，通过 `retain` / `recall` / `reflect` 三个工具维护。

### 工具签名

| 工具      | 用途                         | 调用方式                                       |
| --------- | ---------------------------- | ---------------------------------------------- |
| `retain`  | 存储持久事实                 | `retain({ items: [{ content: "..." }, ...] })` |
| `recall`  | 检索相关记忆                 | `recall({ query: "..." })`                     |
| `reflect` | 跨记忆综合推理（调 LLM，慢） | `reflect({ query: "..." })`                    |

### 规则

- **恢复会话时先 `recall`**，不要问用户"我们上次做了什么"
- **完成重要决策、发现新坑、确认架构变更后立即 `retain`**
- `retain` 的 `items` **必须**使用对象格式 `{ content: string }`；纯字符串会被后端静默丢弃
- 单次批量 25–30 条为宜，上限至少 50 条
- 记忆异步索引，通常秒级可检索
- `reflect` 内部调用 LLM 合成，可能超时（>30s）；优先用 `recall` 直接检索

### 应当 retain 的内容

- 项目架构决策与硬约束
- 踩过的坑及解决方式
- 当前实现状态变更（完成/废弃某模块）
- 用户明确表达的偏好或约定
- 跨会话需要延续的上下文

### 不应 retain 的内容

- 临时调试信息
- 可从代码/文档直接获取的事实
- 大段原始代码（用路径引用代替）

<!-- CODEGRAPH_START -->

## CodeGraph

In repositories indexed by CodeGraph (a `.codegraph/` directory exists at the repo root), reach for it BEFORE grep/find or reading files when you need to understand or locate code:

- **MCP tool** (when available): `codegraph_explore` answers most code questions in one call — the relevant symbols' verbatim source plus the call paths between them, including dynamic-dispatch hops grep can't follow. Name a file or symbol in the query to read its current line-numbered source. If it's listed but deferred, load it by name via tool search.
- **Shell** (always works): `codegraph explore "<symbol names or question>"` prints the same output.

If there is no `.codegraph/` directory, skip CodeGraph entirely — indexing is the user's decision.
<!-- CODEGRAPH_END -->
