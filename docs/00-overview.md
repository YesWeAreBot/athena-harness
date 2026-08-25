# Athena Harness 开发文档

> **一句话定位**：Athena Harness 是**数字生命（digital being）的运行时内核** —— 让实体能够跨多个维度**持续存在**，而不只是被动地响应消息。

本文档面向 athena-harness 的贡献者，人类与 AI agent 双读者。所有文档使用中文叙述，技术术语保留英文原文。

---

## 三原语速览

Athena 把"一个数字生命需要什么才算活着"这个问题，归约为三个不可再分的 primitive：

| Primitive  | 中文     | 回答的问题       | 职责                                                                    |
| ---------- | -------- | ---------------- | ----------------------------------------------------------------------- |
| **Life**   | 生命     | "我是谁？"       | 跨时间持续的身份：persona、memory、self-model                           |
| **Cortex** | 大脑皮层 | "我如何活着？"   | 完整的生存策略：rhythm、integration、cognition、enactment、continuation |
| **Nerve**  | 神经通路 | "我存在于何处？" | 与世界的双向通道：感知信号进、行动指令出                                |

统一隐喻：**Life 通过它的 Cortex 思考决策，Cortex 通过 Nerves 感知世界并行动。**

```
                        ┌─── Nerve (IM)         ──┐
                        │                         │
Life ──owns──► Cortex ──┼─── Nerve (Minecraft)  ──┼──► 世界
  │              │      │                         │
  │              └─── Nerve (Live2D)          ────┘
  │
  └── persona / memory / self-model（跨 Cortex 更替而持续）
```

三个 Cortex 的典型形态：

| 形态                      | Rhythm（何时思考）       | Integration（如何整合）  | Cognition（如何思考）    |
| ------------------------- | ------------------------ | ------------------------ | ------------------------ |
| **Reactive / Chat**       | 外部消息到达             | 立即；单源退化情形       | 有限 tool-loop           |
| **Continuous / World**    | 永不停止；内部 heartbeat | Mailbox 缓冲；"手机"隐喻 | 每拍一次 tool-call，永续 |
| **Narrative / Interlude** | 累积刺激达到阈值         | Debounce；多消息聚合     | 单次 structured-output   |

深入阅读：[01-design-philosophy.md](./01-design-philosophy.md)

---

## 技术栈

| 层          | 选型                       | 版本             | 角色                                   |
| ----------- | -------------------------- | ---------------- | -------------------------------------- |
| 组合基座    | **Cordis**                 | `^4.0.0-rc.8`    | DI、Service、Fiber lifecycle、事件系统 |
| IM 协议     | **自研 Nerve**             | —                | protocol（Body/Session）+ protocol-im（IM 实体/事件） |
| LLM 层      | **AI SDK v7**              | `^7.0.0`         | `generateText` / `streamText` / `tool` |
| 配置 schema | **schemastery**            | `^3.18.0`        | 插件 Config 校验                       |
| 构建        | **yakumo** + esbuild + tsc | —                | monorepo 构建                          |
| 质量        | **oxlint** + **oxfmt**     | —                | lint / format                          |
| 测试        | **Vitest**                 | `^4.1.10`        | 单元测试                               |
| 包管理      | **Yarn**                   | `4.12.0`         | workspaces                             |

关键原则：**不重新发明成熟生态已提供的东西。** 协议层自研（Nerve 三原语），AI SDK 负责 LLM，Cordis 负责组合 —— LLM 与组合直接使用，不做包装层。IM 平台接入统一走 Nerve Body（`IMBody`）模式。

---

## 仓库地图

```
athena-harness/
├── packages/                   ← 库与协议层（不直接提供运行时行为）
│   ├── core/                   @athena-ai/core — prelude shell + 重导出
│   ├── protocol/               @athena-ai/protocol — Nerve 核心：Body + Session + NerveService + Cortex
│   ├── protocol-im/            @athena-ai/protocol-im — IM 协议层：实体类型、IMBody、事件契约
│   └── ai/                     @athena-ai/ai — AIService（provider registry + models.yml + 模型解析）
│
├── plugins/                    ← 可安装的运行时插件
│   ├── life/                   @athena-ai/plugin-life — 提供 ctx.life
│   ├── cortex-chat/            @athena-ai/plugin-cortex-chat — 提供 ctx.cortex
│   ├── nerve-onebot/           @athena-ai/plugin-nerve-onebot — OneBot v11 adapter（IMBody 实现）
│   ├── sandbox/                @athena-ai/plugin-sandbox — 全局 SandboxHub + SandboxBot
│   ├── sandbox-nerve/          @athena-ai/plugin-sandbox-nerve — per-Life Sandbox 桥
│   ├── provider-openai/        @athena-ai/plugin-provider-openai — 注册 AI SDK OpenAI provider
│   ├── provider-deepseek/      @athena-ai/plugin-provider-deepseek — 注册 AI SDK DeepSeek provider
│   ├── provider-anthropic/     @athena-ai/plugin-provider-anthropic — 注册 AI SDK Anthropic provider
│   ├── provider-google/        @athena-ai/plugin-provider-google — 注册 AI SDK Google provider
│   └── message-store/          @athena-ai/plugin-message-store（占位，未开始）
│
├── docs/                       ← 本文档体系
├── .specify/specs/             ← 设计规格与决策记录（历史演进）
└── AGENTS.md                   ← AI agent 工作指南
```

**`packages/` vs `plugins/` 的区分**：`packages/` 放类型、基类、共享库；`plugins/` 放通过 `ctx.plugin()` 安装、提供运行时 Service 的单元。

---

## 快速启动

```bash
# 安装依赖（Yarn 4 workspaces）
yarn install

# 构建全部 package
yarn build

# 运行测试
yarn test

# lint / format
yarn lint
yarn format
```

运行时通过 cordis CLI 启动（当前阶段不自建 CLI）：

```bash
cordis run
```

启动链路：`cordis.yml`（prelude：`@athena-ai/core` + logger）→ `app.yml`（managed plugin tree：Life groups、capability、cortex、adapters）。

验证最快路径是 **Sandbox**：安装 `@athena-ai/plugin-sandbox`（root）+ `@athena-ai/plugin-sandbox-nerve`（per-Life group），打开 WebUI 的 `/sandbox` 页面即可与 Life 对话，无需接入真实 IM 平台。

---

## 文档导航

按你的目的选择入口：

| 我想…                                | 读这个                                                         |
| ------------------------------------ | -------------------------------------------------------------- |
| 理解为什么这样设计、与 Koishi 的差异 | [01-design-philosophy.md](./01-design-philosophy.md)           |
| 理解运行时拓扑、包依赖、隔离机制     | [02-architecture.md](./02-architecture.md)                     |
| 开始写代码（必读）                   | [03-code-conventions.md](./03-code-conventions.md)             |
| 抄一份 Service / Cortex / Nerve 模板 | [04-patterns-and-recipes.md](./04-patterns-and-recipes.md)     |
| 避免前人踩过的坑                     | [05-lessons-learned.md](./05-lessons-learned.md)               |
| 知道现在做到哪、接下来做什么         | [06-progress-and-roadmap.md](./06-progress-and-roadmap.md)     |
| 非技术读者通俗读物                   | [07-athena-harness-book.md](./07-athena-harness-book.md)       |
| 快速查 Cordis v4 概念                | [appendix/A-cordis-primer.md](./appendix/A-cordis-primer.md)   |
| 查 Satori → Nerve 迁移 / 新旧差异    | [appendix/D-satori-to-nerve-migration.md](./appendix/D-satori-to-nerve-migration.md) |
| 查 Satori API（历史参考，已移除）    | [appendix/B-satori-primer.md](./appendix/B-satori-primer.md)   |
| 查某条设计决策的出处                 | [appendix/C-decision-index.md](./appendix/C-decision-index.md) |

---

## 阅读 `.specify/specs/` 的注意事项

`.specify/specs/` 保存的是**设计演进过程**，不是当前实现的权威描述。其中存在已被推翻的内容：

- `capability-protocol-and-entity-model.md` —— 整篇 **SUPERSEDED**
- `spirit-pulse-medium-domain-model.md` —— 概念模型有效，但命名（Spirit/Pulse/Medium）与 pull-based Sense Queue 已废弃
- 其他 spec 中的部分决策已被 `multi-life-isolation-design.md` 修订

**权威顺序**：当前代码 > 用户最新指示 > `docs/`（本文档体系）> `.specify/specs/`。

已知的 spec 与代码冲突见 [06-progress-and-roadmap.md](./06-progress-and-roadmap.md) 的"Spec 与实现的偏差"一节。

---

## 一条底线：退化测试

Athena 只要满足以下任一条，就已经退化成"又一个 Koishi / AstrBot"：

1. Life 只是 Cortex 启动时读一次的 config 文件（没有框架管理的生命周期）
2. Cortex 只是个订阅事件的普通插件（没有可替换单元契约、没有 one-per-Life 约束）
3. 非 IM capability 是二等公民（需要特殊处理，而 IM 是"正常"路径）
4. 框架把 event→response 当作核心流程（自主行为成为事后补丁）
5. Memory / persona 是静态的（没有演化的框架设施）

任何改动如果推向上述任一条，需要在 PR 中明确说明并讨论。
