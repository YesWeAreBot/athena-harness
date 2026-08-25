# 附录 C · 设计决策索引

> 全部设计决策的单行索引，供查找"为什么这样设计"。**编号取自 `.specify/specs/`，不是本文档体系自创。**
>
> ⚠️ `.specify/specs/` 记录的是**设计演进过程**，其中有已被推翻的内容。权威顺序：**当前代码 > 用户最新指示 > `docs/`（本体系）> `.specify/specs/`**。

---

## 编号体系

| 前缀                           | 含义                            | 范围                       | 来源 spec                                       |
| ------------------------------ | ------------------------------- | -------------------------- | ----------------------------------------------- |
| `D-01`~`D-08`                  | Satori / Capability 架构决策    | 已修订多次                 | `satori-capability-architecture.md`             |
| `D-09`~`D-19`                  | 技术选型与工具模型              | —                          | `technology-selection-and-tool-architecture.md` |
| `D-20`~~`D-23`, `D-26`~~`D-32` | 命名与包架构                    | `D-24` / `D-25` **不存在** | `naming-and-package-architecture.md`            |
| `D-33`~`D-36`                  | AI Service 与 Provider Registry | —                          | `model-service-design.md`                       |
| `M-01`~`M-20`                  | capability-message 实现决策     | 部分被修订                 | `capability-message-design.md`                  |
| `M-21`~`M-30`                  | 多 Life 隔离与 Sandbox 拆分     | —                          | `multi-life-isolation-design.md`                |
| `FR-xxx`                       | 功能需求（多条已 SUPERSEDED）   | —                          | `spirit-pulse-medium-domain-model.md`           |

> `D-24` 与 `D-25` 在任何 spec 中都不存在 —— 编号跳过，不是遗漏文档。

---

## D-01 ~ D-08 · Satori 与 Capability 架构

来源：`.specify/specs/satori-capability-architecture.md`

| #        | 决策                                                                                                              | 状态                                                         | 详见                                                                             |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| **D-01** | Satori **就是** messaging 实现；不做专有包装。`ctx.message` 用隔离域包住它，Cortex inject `message` 而非 `satori` | ✅ 已实现（修订过：原版是 Cortex 直接 inject `satori`）      | [02](../02-architecture.md) §7、[05](../05-lessons-learned.md) §6.1              |
| **D-02** | 一个 Nerve = 一个 Bot 实例（一个平台上的一个账号）；多 Bot 协调是 Cortex 的事                                     | ✅ 已实现                                                    | [01](../01-design-philosophy.md) §2.3                                            |
| **D-03** | Capability 是带内部隔离域的 Cordis Service；Cortex 用 `inject` 声明依赖                                           | ✅ 已实现（隔离位置修订，见 M-01）                           | [02](../02-architecture.md) §6、[04](../04-patterns-and-recipes.md) §3           |
| **D-04** | 多 Nerve 寻址用事件来源的 `bot.sid`；单 Bot 时可省略                                                              | ✅ 已实现（`_resolveBot`）                                   | [02](../02-architecture.md) §6.4                                                 |
| **D-05** | **事件投递是 push-based**；消费策略是 Cortex 内部的事。框架不提供 sense queue                                     | ✅ 已实现（推翻了 FR-004/005）                               | [01](../01-design-philosophy.md) §3、[05](../05-lessons-learned.md) §4           |
| **D-06** | Nerve 的内部接口就是 Satori `Methods`；用 `bot.features` 做能力协商                                               | ✅ 已实现                                                    | [B](./B-satori-primer.md) §3.5、§3.6                                             |
| **D-07** | Capability token 是稳定标识符：`'message'` / `'minecraft'` / `'expression'` / `'audio'`。枚举开放，单项稳定       | 🔸 仅 `'message'` 已实现（修订过：原版 token 是 `'satori'`） | [02](../02-architecture.md) §6.1                                                 |
| **D-08** | **Layer 3（Nerve 提供的平台透传 tool）机制延后设计**                                                              | ⏸️ 延后                                                      | [01](../01-design-philosophy.md) §6、[06](../06-progress-and-roadmap.md) Phase 3 |

### 该 spec 中被推翻的项

| 项                                | 结论                                                                     |
| --------------------------------- | ------------------------------------------------------------------------ |
| ~~Cortex 直接 inject `satori`~~   | 被 D-01 修订版取代 —— Cortex inject `message`                            |
| ~~为 IM 单独设一个 Nerve 框架类~~ | 不需要 —— MessageService 内的 Satori Adapter + Bot 已履行全部 Nerve 职责 |

---

## D-09 ~ D-19 · 技术选型与工具模型

来源：`.specify/specs/technology-selection-and-tool-architecture.md`

| #        | 决策                                                                            | 分类          | 状态                                                          | 详见                                                                               |
| -------- | ------------------------------------------------------------------------------- | ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **D-09** | LLM 层直接用 **AI SDK v7**，不做 wrapper                                        | Tech Stack    | 🔸 `AIService` 已实现并接线；Cortex 侧未集成                  | [05](../05-lessons-learned.md) §6.2、[06](../06-progress-and-roadmap.md) Phase 2-A |
| **D-10** | **Cordis v4**（`^4.0.0-rc.8`）作为组合基座                                      | Tech Stack    | ✅ 已实现                                                     | [A](./A-cordis-primer.md)                                                          |
| **D-11** | 从 git main 分支 **vendor Satori v5 alpha**                                     | Tech Stack    | ⚠️ **已撤销（2026-08）**：Satori → Nerve 迁移后 vendor 已删除 | [D](./D-satori-to-nerve-migration.md)、[02](../02-architecture.md) §11             |
| **D-12** | IM 连通经 **Satori Protocol 桥接到 Koishi** 实例                                | Tech Stack    | ⚠️ **已撤销**：Nerve 协议自研后不需要 Koishi 桥               | [D](./D-satori-to-nerve-migration.md) §3.1                                         |
| **D-13** | Athena Runtime **不是**独立产品；harness core 作为其内部依赖嵌入                | Architecture  | ⏸️ 未落地                                                     | —                                                                                  |
| **D-14** | **无 tool context 注入** —— LLM 通过参数寻址目标                                | Tool Model    | ⏸️ 待 Phase 2-C 验证                                          | [01](../01-design-philosophy.md) §6、[05](../05-lessons-learned.md) §9             |
| **D-15** | Tool 通过注册时所在的 Cordis context 访问 service，不通过注入参数或闭包捕获实例 | Tool Model    | ⏸️ 待 Phase 2-A                                               | [04](../04-patterns-and-recipes.md) §5.2                                           |
| **D-16** | **`ctx.tools`** 作为 Tool Registry Service（register / discover / execute）     | Tool Model    | ❌ 未开始                                                     | [02](../02-architecture.md) §9.3、[06](../06-progress-and-roadmap.md) Phase 2-A    |
| **D-17** | Life Config —— per-Life 声明式装配 YAML                                         | Configuration | 🔸 被 D-21 改名为 **Instance**；文件加载未实现                | [02](../02-architecture.md) §10                                                    |
| **D-18** | Tool 隔离由 **Cordis context tree** 天然提供，无需额外机制                      | Configuration | ⏸️ 待 Phase 2-A                                               | [02](../02-architecture.md) §9.3                                                   |
| **D-19** | Cortex 内部策略切换（**Preset**）—— **延后**                                    | Future        | ⏸️ 延后                                                       | [01](../01-design-philosophy.md) §2.2                                              |

---

## D-20 ~ D-23, D-26 ~ D-32 · 命名与包架构

来源：`.specify/specs/naming-and-package-architecture.md`

### D-20 · 三原语命名

| 职责     | 名字       | 中文     | 隐喻                                         | 取代                      |
| -------- | ---------- | -------- | -------------------------------------------- | ------------------------- |
| 持续身份 | **Life**   | 生命     | 数字生命本身                                 | Spirit                    |
| 生存策略 | **Cortex** | 大脑皮层 | 皮层功能：感知整合、决策、运动规划、时间控制 | Pulse / Mode              |
| 世界接口 | **Nerve**  | 神经通路 | 双向导管：感觉信号进，运动指令出             | Medium / Body / Interface |

统一隐喻：**Life 通过 Cortex 思考决策，Cortex 通过 Nerve 感知世界并行动。**

选名理由：`Life` 直接映射产品目标，v1 原名，直觉最强；`Cortex` 解剖学准确，**不**暗示可切换性（不会热插拔皮层），无 TS 关键字冲突；`Nerve` 与 Cortex 解剖学关系正确，双向导管语义与"感知 + 行动"完全对应，粒度正确（一条 nerve = 一条完整连接通路）。

状态：✅ 代码已全面采用。

### D-21 · 配套概念命名

| 概念                | 名字         | 定义                                                                                         |
| ------------------- | ------------ | -------------------------------------------------------------------------------------------- |
| 部署配置            | **Instance** | 描述一个 Life 如何组装的声明式 YAML（原 "Life Config"，见 D-17）。路径 `instances/alice.yml` |
| Cortex 内部行为切换 | **Preset**   | 单个 Cortex 内的动态策略/风格切换（见 D-19，延后）                                           |

状态：🔸 命名确立；`instances/` 目录尚未落地。

### D-22 · 包命名方案（Scheme C —— 语义前缀）

npm scope：`@athena-ai`（工作名，未来可能替换为最终品牌名）

| 包类型          | 官方模式                   | 社区（无 scope）       | 社区（有 scope）              |
| --------------- | -------------------------- | ---------------------- | ----------------------------- |
| Core / 基础设施 | `@athena-ai/core`          | —                      | —                             |
| Cortex 插件     | `@athena-ai/cortex-<name>` | `athena-cortex-<name>` | `@scope/athena-cortex-<name>` |
| Nerve 插件      | `@athena-ai/nerve-<name>`  | `athena-nerve-<name>`  | `@scope/athena-nerve-<name>`  |
| 通用插件        | `@athena-ai/plugin-<name>` | `athena-plugin-<name>` | `@scope/athena-plugin-<name>` |

理由：Cortex 与 Nerve 是本身携带类型信息的领域概念，不需要冗余的 `plugin-` 前缀；不属于该分类的通用插件（memory、scheduler）用 `plugin-` 前缀，与 Cordis/Koishi 生态一致；纯库包无前缀。

状态：⚠️ 大体遵循，但存在**包名与目录错位**缺陷（`plugins/capability-message` 与 `plugins/message-store` 的 name 互换）。见 [06](../06-progress-and-roadmap.md) §3 P0-1。

### D-23 · Hook Protocol（社区扩展机制）

**原则：约定优于强制。**

| Hook 点                   | Dispatch 模式 | 语义                                    |
| ------------------------- | ------------- | --------------------------------------- |
| `cortex/before-drain`     | `waterfall`   | 整合前变换/过滤感知事件                 |
| `cortex/after-integrate`  | `waterfall`   | 向装配好的上下文注入内容（RAG、memory） |
| `cortex/before-cognition` | `waterfall`   | LLM 调用前修改 prompt / tools / 参数    |
| `cortex/before-enact`     | `bail`        | 拦截/否决行动（内容审核、限流）         |
| `cortex/after-enact`      | `parallel`    | 行动后副作用（日志、统计、触发器）      |

三个扩展层：tool 注册（`ctx.tools`）、lifecycle hooks（上表）、~~Cortex mixin~~（**不支持**，对内部一致性风险过高）。

> ⚠️ **spec 中把 `waterfall` 描述为 reducer 是不准确的。** cordis v4 的 `waterfall` 是 **`next()` 中间件链**（koa 风格），listener 签名为 `(...args, next)`。详见 [A](./A-cordis-primer.md) §6.3。

状态：❌ 契约未在 `@athena-ai/protocol` 中声明。见 [06](../06-progress-and-roadmap.md) Phase 2-B。

### D-26 ~ D-32

| #        | 决策                                                                                                                                                               | 状态                                                             | 详见                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **D-26** | **Cortex 不可运行时热切换** —— 不同 Cortex 状态结构不兼容。换 Cortex = 显式 stop + start；Life memory 持续，Cortex 内部状态丢失。Preset **是**可动态切换的（延后） | ✅ 设计确立                                                      | [01](../01-design-philosophy.md) §2.2                                  |
| **D-27** | **Capability 包是核心契约** —— 依赖倒置：Cortex 依赖 Capability（抽象契约），Nerve 实现 Capability。Cortex 永不依赖具体 Nerve 包                                   | ✅ 已实现                                                        | [01](../01-design-philosophy.md) §2.3、[02](../02-architecture.md) §6  |
| **D-28** | **Sense Queue 被 Cordis 事件取代** —— 无框架级 Sense Queue 抽象；Nerve（经 Capability）发射 Cordis 事件；Cortex 自管理缓冲                                         | ✅ 已实现                                                        | [01](../01-design-philosophy.md) §3、[05](../05-lessons-learned.md) §4 |
| **D-29** | **Cortex 契约 = 带 `inject` 的 Cordis Service** —— `ctx.plugin(CortexChat, config)` 安装；`static inject` 声明必需 capability；生命周期遵循 fiber 语义             | ✅ 已实现（`Cortex` 基类）                                       | [04](../04-patterns-and-recipes.md) §2                                 |
| **D-30** | **Nerve 契约 = Capability 贡献者** —— 向 Capability service 注册实例；IM Nerve 注册 Bot 进 `ctx.message` 的域；经 Cordis 事件发射领域事件                          | ✅ 已实现（`sandbox-nerve` 为参考）                              | [04](../04-patterns-and-recipes.md) §4                                 |
| **D-31** | **包目录布局** —— `packages/`（库）/ `plugins/`（运行时单元）/ `vendor/`（上游快照）                                                                               | ✅ 已实现                                                        | [02](../02-architecture.md) §2、[03](../03-code-conventions.md) §5     |
| **D-32** | **依赖图** —— `core` → `protocol` → `life` / `cortex-*`；`capability-*` 依赖 vendor；Cortex 双 inject                                                              | ✅ 已实现（有小偏差，见 [06](../06-progress-and-roadmap.md) §2） | [02](../02-architecture.md) §2.2                                       |

---

## D-33 ~ D-36 · AI Service 与 Provider Registry

来源：`.specify/specs/model-service-design.md`

| #        | 决策                                                                                                                                                                                      | 状态                                         | 详见                                                                   |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------------- |
| **D-33** | **AIService 是全局单例** —— provide key `'ai'`（`ctx.model` 已被 cordis database 生态占用）；**不进**隔离集合，因为模型是无状态共享资源，且 ProviderV4 天然跨模态                         | ✅ 已实现（`@athena-ai/ai`）                 | [02](../02-architecture.md) §9、[04](../04-patterns-and-recipes.md) §5 |
| **D-34** | **Provider 插件前端配置只放 `id` / `apiKey` / `baseURL`** —— headers、per-provider/per-model defaults、模型声明、aliases、groups 全部下沉到 `models.yml`；Provider 插件不知道它存在       | ✅ 已实现（`provider-openai` / `-deepseek`） | [02](../02-architecture.md) §9、[04](../04-patterns-and-recipes.md) §5 |
| **D-35** | **`candidates()` 统一入口 + `.group()` 显式方法** —— Group 只做模型排序 + 断路器，**不**包装 `streamText` / `generateText`；重试/failover 循环由 Cortex 自己写（与 D-28 push-based 同理） | ✅ 已实现（含断路器与三种策略）              | [04](../04-patterns-and-recipes.md) §5                                 |
| **D-36** | **反对运行时 npm 安装、不自建动态 Schema 前端** —— 供应链安全 + 离线可用 + ROI 不足                                                                                                       | ✅ 设计确立                                  | `.specify/specs/model-service-design.md` §12                           |

---

## M-01 ~ M-20 · capability-message 实现决策

来源：`.specify/specs/capability-message-design.md`

| #        | 决策                                                                                                                                        | 状态                                                                                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **M-01** | MessageService 用 `ctx.isolate('satori').isolate('bots')` 创建**内部**域                                                                    | ⚠️ **已修订**（`multi-life-isolation-design.md` §5）—— 改为由外层 group entry 声明 `isolate: { satori: true }`；satori 在 group 内可见（sibling adapter 需要），跨 group 隔离 |
| **M-02** | 事件作用域经 Session 上的 `[Context.filter]` 注入实现 —— MessageService 注入匹配 `message` isolate symbol 的 filter；多 Life 事件不跨域泄漏 | ✅ 已实现                                                                                                                                                                     |
| **M-03** | `ctx.message.bots` 直接暴露 `Bot[]`，不做包装 —— Satori Bot **就是**标准                                                                    | ✅ 已实现                                                                                                                                                                     |
| **M-04** | MessageService 上提供便捷方法 —— 单 bot 场景无需 bot 选择逻辑                                                                               | ✅ 已实现（`createMessage` / `sendMessage` / `sendPrivateMessage`）                                                                                                           |
| **M-05** | Adapter 经 `config.adapters` 数组或 `ctx.message.adapter()` 安装                                                                            | ⚠️ **实际做法不同** —— adapter 作为 group 内 sibling entry 安装（`inject: ["satori"]`），MessageService 无 `adapters` 配置项                                                  |
| **M-06** | Satori v5 alpha 是目标（从 git vendor）—— 兼容 cordis v4；v4 stable 需要 cordis v3（不兼容）                                                | ✅ 已实现                                                                                                                                                                     |
| **M-07** | Fallback：只用 protocol + 重实现 core（若 v5 不可用）—— 可行但预计无必要，约 400 行核心逻辑                                                 | ⏸️ 未采用                                                                                                                                                                     |
| **M-08** | 不做专有事件包装 —— Satori Session 已结构良好                                                                                               | ✅ 已实现                                                                                                                                                                     |
| **M-09** | Cortex 声明 `inject: ['message']` —— **永不** `['satori']`                                                                                  | ✅ 已实现                                                                                                                                                                     |
| **M-10** | 框架在无 messaging 时可运行 —— MessageService 是可选的                                                                                      | ⏸️ 待 Phase 4 验证                                                                                                                                                            |
| **M-11** | `@athena-ai/core` 作为 **prelude** 加载，不在 managed `app.yml` 中 —— 内核不可"卸载"；与 `@koishijs/core` 同模式                            | ✅ 设计确立（部署配置在外部仓库）                                                                                                                                             |
| **M-12** | 直接用 cordis CLI；自定义 `athena start` **延后** —— prelude 机制已提供独立性，与 CLI 品牌无关                                              | ✅ 已采用                                                                                                                                                                     |
| **M-13** | Core **不**继承 satori `Context` —— 框架身份 ≠ messaging；与 Koishi 的核心差异                                                              | ✅ 已实现                                                                                                                                                                     |
| **M-14** | Cordis 生态插件（HMR、webui、database）完全可复用 —— 与 athena capability 并列安装在 `app.yml`                                              | ✅ 设计确立                                                                                                                                                                   |
| **M-15** | `@athena-ai/core` 只含类型 + 基类，无运行时 service                                                                                         | ⚠️ **已被 M-22 / M-23 取代** —— 类型移入 `@athena-ai/protocol`，core 成为 prelude shell                                                                                       |
| **M-16** | `@athena-ai/plugin-life` 提供 `ctx.life`（persona、memory、one-Cortex 强制）—— per-Life scope 的具体运行时，多 Life 时多次安装              | ✅ 已实现                                                                                                                                                                     |
| **M-17** | capability-message **不依赖** core —— capability 是纯 cordis Service；连接在 Cortex 层通过双 inject 发生                                    | ⚠️ **存在偏差** —— 实际为了 `Schema` 而依赖 core；若要严格遵守应直接依赖 `schemastery`                                                                                        |
| **M-18** | one-Cortex-per-Life 由 Cortex 基类的 `registerCortex()` 强制 —— 第二个 Cortex 立即抛错                                                      | ⚠️ **已被 M-25 取代** —— 改为 `Life.bind(cortex)` 返回 disposer                                                                                                               |
| **M-19** | Instance = 标准 YAML，经 `plugin-include` 加载 —— 无自定义 loader，完整 cordis 生态兼容（WebUI、HMR）                                       | 🔸 设计确立，`instances/` 未落地                                                                                                                                              |
| **M-20** | 多 Life 隔离用 cordis loader 在 `plugin-group` 上的 `isolate` config                                                                        | ⚠️ **已被 M-24 修订** —— 从 `{ life, message }` 扩展为 `{ life, cortex, message, satori }`                                                                                    |

---

## M-21 ~ M-30 · 多 Life 隔离与 Sandbox 拆分

来源：`.specify/specs/multi-life-isolation-design.md`（状态：Approved / Implemented）

| #        | 决策                                                                                                       | 理由                                                                      | 状态                            |
| -------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------- |
| **M-21** | Vendored Satori **移除** `ctx.mixin('satori', ['bots', 'component'])`                                      | 消除多实例 accessor 冲突                                                  | ✅ 已实现                       |
| **M-22** | 新建 `@athena-ai/protocol` 包放类型 + `Cortex` abstract class                                              | 接口与实现的干净分离                                                      | ✅ 已实现                       |
| **M-23** | `@athena-ai/core` 成为 prelude shell（无类型、无 service）                                                 | 为未来的预处理 hook 留位；轻量                                            | ✅ 已实现                       |
| **M-24** | `app.yml` 的 isolate config 是 `{ life, cortex, message, satori }`                                         | adapter 需要 sibling 访问 satori；mixin 移除后这样做是安全的              | ✅ 已实现                       |
| **M-25** | `Life.bind(cortex)` 返回 disposer；无显式 `unbind()`                                                       | 借用 cordis 生命周期；按 name 比较以兼容 proxy                            | ✅ 已实现                       |
| **M-26** | 所有 `ctx.bots` 引用替换为 `ctx.satori.bots`                                                               | 与 mixin 移除保持一致                                                     | ✅ 已实现（类型声明残留待清理） |
| **M-27** | Sandbox 拆分为 Hub（root，provides `'sandbox'`）+ Nerve（per-group，inject `['sandbox','satori','life']`） | Hub 拥有全局 WebUI 页面；Nerve 拥有隔离 Satori 域内的 per-Life SandboxBot | ✅ 已实现                       |
| **M-28** | 所有 `sandbox/*` wire frame 携带 `lifeId` 字段                                                             | 单个 WebSocket 多路复用多个 Life；前端按 lifeId 路由                      | ✅ 已实现                       |
| **M-29** | Hub 在 dispatch payload 中传 `MessageSink` 作为回复传输                                                    | Nerve/Bot 不依赖 WebUI 内部；Hub 自动在回复上打 lifeId                    | ✅ 已实现                       |
| **M-30** | `sandbox` service **不**在 group config 中隔离                                                             | Hub 是全局的；Nerve 从 root 正常 inject 抵达它                            | ✅ 已实现                       |

---

## FR · 功能需求（含已废弃项）

来源：`.specify/specs/spirit-pulse-medium-domain-model.md`

> ⚠️ 该文档的**概念模型**（三原语、关系、三层工具、组合示例）仍是权威参考；但**命名**（Spirit/Pulse/Medium）与部分实现细节已废弃。

| #          | 需求                                                                                        | 状态                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| **FR-004** | Nerve 必须可在运行时热安装/热移除（经 Cordis 插件生命周期）                                 | ✅ 有效                                                                                           |
| **FR-005** | ~~事件投递从 Nerve 到 Cortex 必须是 **pull-based**~~                                        | ❌ **SUPERSEDED by D-05 / D-28** —— 改为 push-based；框架不提供 sense queue                       |
| **FR-006** | Cortex 内的事件处理默认必须串行化（除显式 opt-in 并行）                                     | ⚠️ **责任转移** —— 框架不代管；Cortex 自行实现串行锁。见 [04](../04-patterns-and-recipes.md) §8.9 |
| **FR-007** | Nerve 必须同时暴露结构化能力（程序化，给 Cortex 代码）与透传 tool（自描述，给 LLM）         | 🔸 Layer 1 已实现；Layer 3 延后（D-08）                                                           |
| **FR-008** | Cortex 必须定义产品语义 tool（Layer 2），内部调用结构化能力。LLM 永不直接调用原始结构化能力 | ⏸️ 待 Phase 2-C                                                                                   |

### 该文档中已废弃的实体

| 实体                       | 结论                                                                                    |
| -------------------------- | --------------------------------------------------------------------------------------- |
| ~~**Sense Queue**~~        | **SUPERSEDED** —— 不再是框架实体（D-05 / D-28）                                         |
| ~~**Medium 作为框架类**~~  | IM 场景**不需要** —— MessageService 内的 Satori Adapter + Bot 已履行职责（D-01 修订版） |
| **Unified Event Envelope** | 未采用 —— Cortex 直接收原始 Satori Session（M-08）                                      |

---

## 命名迁移表

阅读旧 spec 时按此翻译：

| 旧术语                                | 新术语                      | 决策        |
| ------------------------------------- | --------------------------- | ----------- |
| Spirit                                | **Life**                    | D-20        |
| Pulse / Mode                          | **Cortex**                  | D-20        |
| Medium / Body / Interface（作为原语） | **Nerve**                   | D-20        |
| Life Config                           | **Instance**                | D-21        |
| Pulse Preset                          | **Cortex Preset**           | D-21        |
| Capability Protocol（自建机制）       | Cordis Service + `inject`   | D-27        |
| Sense Queue                           | （无 —— Cortex 自管理缓冲） | D-05 / D-28 |
| `'satori'`（capability token）        | `'message'`                 | D-07 修订版 |

---

## Spec 文件状态

| 文件                                            | 状态                   | 如何阅读                                                                       |
| ----------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------ |
| `design-philosophy-and-positioning.md`          | ✅ 有效                | 定位与差异化的权威来源                                                         |
| `satori-capability-architecture.md`             | 🔸 大部分有效          | D-01 / D-03 / D-07 已修订，按本索引对照                                        |
| `technology-selection-and-tool-architecture.md` | 🔸 大部分有效          | D-17 被 D-21 改名；Part IV 的历史分析仍有价值                                  |
| `naming-and-package-architecture.md`            | ✅ 有效                | 命名与包架构的权威来源                                                         |
| `capability-message-design.md`                  | ⚠️ 多处被修订          | M-01 / M-05 / M-15 / M-17 / M-18 / M-20 已变更；Part XI 的 core 边界描述已过时 |
| `multi-life-isolation-design.md`                | ✅ 有效（最新）        | 隔离机制的权威来源；含根因分析                                                 |
| `model-service-design.md`                       | ✅ 有效（最新）        | AI Service / Provider Registry 的权威来源；Phase 2-A 已落地                    |
| `spirit-pulse-medium-domain-model.md`           | 🔸 概念有效，实现废弃  | 命名按迁移表翻译；FR-005 / Sense Queue 已废弃                                  |
| `capability-protocol-and-entity-model.md`       | ❌ **整篇 SUPERSEDED** | 仅作演进记录                                                                   |

---

## 未决问题索引

完整列表见 [06-progress-and-roadmap.md](../06-progress-and-roadmap.md) §5。速览：

| 领域        | 未决数 | 代表问题                                                                                               |
| ----------- | ------ | ------------------------------------------------------------------------------------------------------ |
| 设计层      | 6      | Memory 基础设施形态、Self-model 表示、Cortex 契约接口规范、可观测性、退化测试形式化、Hook 载荷抽象层级 |
| 工具模型    | 5      | Bot 归属强制、tool 描述动态化、`ctx.tools` hook、tool 命名空间、Layer 3 机制（D-08）                   |
| 运行时/运维 | 4      | 多 Life 共享 Bot、adapter 热重载、vendor 维护流程、Cortex Preset 形态                                  |

---

## 新增决策的规矩

1. **编号连续** —— 从 `D-37` / `M-31` 继续，**不要**复用 `D-24` / `D-25`（历史跳号，保持跳过）
2. **写进 `.specify/specs/`** —— 新建 spec 或追加到最相关的现有 spec，含理由与替代方案
3. **在本索引登记** —— 一行摘要 + 状态 + 指向 `docs/` 的链接
4. **修订旧决策时**：
   - **不删除**旧条目，标注 ⚠️ **已修订** / ❌ **SUPERSEDED** 并指向新决策
   - 在 [06](../06-progress-and-roadmap.md) §2 的偏差表中同步
   - 若旧决策已写进代码，在 [05](../05-lessons-learned.md) 记录为什么原方案不成立
5. **触及架构不变式时** —— 对照 [02](../02-architecture.md) §12 的十条，并在 PR 中说明是否推向 [01](../01-design-philosophy.md) §8.1 的任一条退化测试
