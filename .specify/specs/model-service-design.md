# AI Service 设计方案

> **状态**：✅ Accepted — Phase 2-A 已实现（`packages/ai`、`plugins/provider-openai`、`plugins/provider-deepseek`）  
> **关联决策**：D-33 ~ D-36  
> **Phase**：2-A · AI 基础设施  
> **讨论记录**：基于多轮设计讨论收敛，不沿用 YesImBot ModelService  
>
> **实现与本文的差异**（以代码为准）：
>
> - `models.yml` 的 `defaults` 键名必须是 AI SDK 的 call setting 名 —— 用 `maxOutputTokens`，本文早期示例中的 `maxTokens` 是错的
> - per-provider `options.headers` 与 per-provider / per-model `defaults` 合并为**一个** `defaultSettingsMiddleware`（`mergeObjects` 深合并，语义与分层 wrap 等价，少一层包装）
> - 断路器与三种策略**已在 2-A 实现**（本文 §10 原计划推到 2-C）—— 否则 `Candidate.success()` / `failure()` 会是空壳
> - 两条刻意的降级行为：group 成员解析失败 → 跳过并 warn；全部断路器都开 → warn 后仍返回完整列表
> - speech / transcription / reranking 没有上游 wrapper，返回裸模型（`headers` 需调用时传）

---

## 一、设计原则

1. **不自造类型体系**——返回 AI SDK 原生类型，使用 AI SDK middleware 不算包装
2. **前端表单只放凭据+标识**——Provider 插件 Config 只有 id + apiKey + baseURL（3 字段，渲染清爽）
3. **模型知识统一管理**——声明、元数据、aliases、defaults、groups 放 `models.yml`
4. **策略是 Cortex 的事**——重试/failover 循环由 Cortex 自行实现，框架只提供模型选择 + 断路器状态
5. **与 AI SDK ProviderV4 对齐**——Provider 天然跨模态，不按模态拆分 Service

---

## 二、整体架构

```
┌─ Root Context ──────────────────────────────────────────────────────┐
│                                                                     │
│  @athena-ai/ai (AIService, provides 'ai')                           │
│    ├── models.yml 加载（providers / models / aliases / defaults /   │
│    │   groups / per-model defaults / per-provider options）          │
│    ├── Provider Registry (Map<id, ProviderV4>)                      │
│    ├── resolve 时 wrap middleware（defaults + headers 注入）         │
│    └── API:                                                         │
│         .language(input?) → LanguageModelV4                         │
│         .embedding(input?) → EmbeddingModelV4                       │
│         .candidates(input) → Candidate[]                            │
│         .group(name) → ModelGroup                                   │
│                                                                     │
│  @athena-ai/provider-openai (inject: ['ai'])                        │
│    └── createOpenAI({ apiKey, baseURL })                            │
│    └── ctx.ai.register('openai', provider)                          │
│    ← 前端 Config: { apiKey, baseURL }                              │
│                                                                     │
│  @athena-ai/provider-deepseek (inject: ['ai'])                      │
│    └── ctx.ai.register('deepseek', provider)                        │
│                                                                     │
│  ┌─ Alice Group ────────────────────────────────────────────────┐   │
│  │  CortexChat (inject: ['life','message','ai'])                 │   │
│  │    for (const c of ctx.ai.candidates(config.model)) {         │   │
│  │      try { streamText({ model: c.model, ... }); c.success() } │   │
│  │      catch { c.failure(); continue }                          │   │
│  │    }                                                          │   │
│  └───────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 三、分层架构

```
┌─ Cortex 调用层 ──────────────────────────────────────────────────┐
│  自行实现重试/failover 循环：                                     │
│  for (const candidate of ctx.ai.candidates(config.model)) {      │
│    try { streamText({ model: candidate.model, ... }); }          │
│    catch { candidate.failure(); continue; }                      │
│    candidate.success(); break;                                   │
│  }                                                               │
└──────────────────────────────────────────────────────────────────┘
         ↑
┌─ Group 策略层（Phase 2-C）───────────────────────────────────────┐
│  candidates() → 按策略排序，跳过断路器开启的模型                  │
│  success(id) / failure(id) → 断路器状态更新                      │
│  策略：failover / round-robin / random                           │
└──────────────────────────────────────────────────────────────────┘
         ↑
┌─ Registry 基础层（Phase 2-A）────────────────────────────────────┐
│  register(id, provider) → disposer                               │
│  resolve(id):                                                    │
│    provider.languageModel(modelId) → 裸 LanguageModelV4          │
│    wrapLanguageModel(model, [                                    │
│      defaultsMiddleware(per-model defaults from models.yml),     │
│      headersMiddleware(per-provider options from models.yml),    │
│    ])                                                            │
│    → 返回已注入默认参数的 LanguageModelV4                        │
└──────────────────────────────────────────────────────────────────┘
```

### Middleware 注入逻辑

Provider 插件只管 `createXxx({ apiKey, baseURL })` 注册裸 provider。AIService 在 resolve 时 wrap middleware，注入 `models.yml` 中的配置：

- **per-provider defaults**（temperature、maxTokens 等）→ `defaultSettingsMiddleware`（最低优先级）
- **per-model defaults**（temperature、providerOptions 等）→ `defaultSettingsMiddleware`（覆盖 provider 级别）
- **per-provider options.headers** → headers middleware

优先级（高→低）：
1. 运行时调用方传入的参数（Cortex 在 streamText/generateText 中显式指定）
2. `models.yml` 中 per-model `defaults` 定义
3. `models.yml` 中 per-provider `defaults` 定义
4. `models.yml` 中 per-provider `options.headers`

---

## 四、接口设计

### 4.1 AIService

```typescript
import type {
  EmbeddingModelV4,
  ImageModelV4,
  LanguageModelV4,
  ProviderV4,
  RerankingModelV4,
  SpeechModelV4,
  TranscriptionModelV4,
} from "@ai-sdk/provider";
import { Context, Service } from "cordis";

export type ModelType = "language" | "embedding" | "image" | "speech" | "transcription" | "reranking";

declare module "cordis" {
  interface Context {
    ai: AIService;
  }
}

export interface AIServiceConfig {
  /** models.yml 路径，默认 ./models.yml */
  configPath?: string;
}

export default class AIService extends Service<AIServiceConfig> {
  static inject = [];

  constructor(ctx: Context, public config: AIServiceConfig) {
    super(ctx, "ai");
  }

  // ─── Provider 生命周期 ────────────────────────────────────

  /**
   * 注册 AI SDK ProviderV4，返回 disposer。
   * id 重复时抛出错误并通过 logger.error 输出日志。
   */
  register(id: string, provider: ProviderV4): () => void;

  /** 列出已注册的 provider ID */
  providers(): string[];

  // ─── 单模型快捷解析 ──────────────────────────────────────

  /** 解析 language model，input 省略时用 defaults.language */
  language(input?: string): LanguageModelV4;

  /** 解析 embedding model */
  embedding(input?: string): EmbeddingModelV4;

  /** 解析 image model */
  image(input?: string): ImageModelV4;

  /** 解析 speech model (TTS) */
  speech(input?: string): SpeechModelV4;

  /** 解析 transcription model (STT) */
  transcription(input?: string): TranscriptionModelV4;

  /** 解析 reranking model */
  reranking(input?: string): RerankingModelV4;

  // ─── 候选列表（统一入口）─────────────────────────────────

  /**
   * 解析模型候选列表。
   * - 含 ':' → 单模型，返回 [Candidate]
   * - 不含 ':' → 先查 groups，再查 aliases（alias 解析为单候选）
   */
  candidates(input: string): Candidate[];

  // ─── 显式 group ──────────────────────────────────────────

  /** 获取命名 group，不存在则抛错 */
  group(name: string): ModelGroup;

  // ─── 查询 ────────────────────────────────────────────────

  /** 获取默认模型 ID */
  default(type: ModelType): string | undefined;

  /** 查询模型元数据 */
  metadata(fullId: string): ModelMetadata | undefined;

  /** 列出已知模型 */
  list(type?: ModelType): ModelEntry[];
}
```

### 4.2 Candidate

```typescript
export interface Candidate {
  /** 完整模型 ID，如 "openai:gpt-4o" */
  readonly id: string;

  /** 已 wrap defaults middleware 的 AI SDK 原生模型 */
  readonly model: LanguageModelV4;

  /** 模型元数据（来自 models.yml） */
  readonly metadata: ModelMetadata;

  /** 标记本次使用成功——通知断路器 */
  success(): void;

  /** 标记本次使用失败——通知断路器 */
  failure(): void;
}
```

### 4.3 ModelMetadata

```typescript
export interface ModelMetadata {
  /** 人类友好名 */
  name?: string;
  /** 是否支持 tool calling */
  toolCall?: boolean;
  /** 是否支持推理 */
  reasoning?: boolean;
  /** 支持的模态 */
  modalities?: {
    input?: string[];
    output?: string[];
  };
  /** token 限制 */
  limit?: {
    context?: number;
    output?: number;
  };
}
```

### 4.4 ModelGroup

```typescript
export interface ModelGroup {
  readonly name: string;
  readonly strategy: "failover" | "round-robin" | "random";

  /** 返回按策略排序的候选列表，已跳过断路器开启的 */
  candidates(): Candidate[];

  /** 断路器状态查询 */
  status(): Map<string, CircuitBreakerStatus>;

  /** 手动重置某个模型的断路器 */
  reset(id: string): void;
}

export interface CircuitBreakerStatus {
  state: "closed" | "open" | "half-open";
  failures: number;
}
```

### 4.5 ModelEntry（查询用）

```typescript
export interface ModelEntry {
  id: string;
  type: ModelType;
  provider: string;
  fullId: string;
  metadata?: ModelMetadata;
}
```

---

## 五、Provider 插件

### 5.1 前端配置（WebUI 表单渲染）

```typescript
// @athena-ai/provider-openai
export const name = "provider-openai";
export const inject = ["ai"];
export const reusable = true;

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai").description("提供商标识（不可与其他提供商重复）"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("自定义 API 地址"),
});
```

前端表单效果：
```
┌─────────────────────────────────┐
│ 标识       [openai          ]   │
│ API Key    [••••••••••••••••]   │
│ Base URL   [                ]   │
└─────────────────────────────────┘
```

### 5.2 插件实现

```typescript
import { createOpenAI } from "@ai-sdk/openai";
import type { Context } from "cordis";

export function apply(ctx: Context, config: Config) {
  const provider = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  // register 内部检查 ID 重复：重复时抛错 + logger.error
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-${config.id}.unregister`);
}
```

Provider 插件不知道 `models.yml` 的存在。headers、per-provider defaults、per-model defaults 全部由 AIService 在 resolve 时通过 middleware 注入。

### 5.3 reusable 与 ID 冲突

同一 provider 包允许多次安装（`reusable = true`）——例如公司内部 OpenAI-compatible 网关 + 官方 OpenAI：

```yaml
# app.yml
- name: "@athena-ai/provider-openai"
  config:
    id: openai
    apiKey: ${{ env.OPENAI_API_KEY }}

- name: "@athena-ai/provider-openai"
  config:
    id: openai-internal
    apiKey: ${{ env.INTERNAL_API_KEY }}
    baseURL: https://internal-gateway.company.com/v1
```

**ID 重复处理**：若 `register(id, provider)` 时该 ID 已存在，AIService 将：
1. 抛出 `Error(`Provider "${id}" is already registered`)`
2. 通过 `ctx.logger("ai").error(...)` 输出日志

Provider 插件的 fiber 会因未捕获异常而失败，在 WebUI 中显示为错误状态，提示用户修改 ID。

---

## 六、`models.yml` Schema

```yaml
# ─── 全局配置 ────────────────────────────────────────────────

# 默认模型：快捷方法省略 input 时使用
defaults:
  language: deepseek:deepseek-chat
  embedding: openai:text-embedding-3-small
  # image / speech / transcription / reranking 可选

# 短名别名
aliases:
  fast: openai:gpt-4o-mini
  smart: anthropic:claude-sonnet-4-5
  cheap: deepseek:deepseek-chat

# 严格模式：true = 只允许声明的模型 resolve；false = 宽松
strict: false

# ─── Provider 模型声明 ───────────────────────────────────────

providers:
  openai:
    # provider 级别选项（headers 等），resolve 时通过 middleware 注入
    options:
      headers:
        X-Custom-Header: some-value
    # provider 级别运行时参数默认值，该 provider 下所有模型共享
    defaults:
      maxTokens: 4096
    models:
      - id: gpt-4o
        type: language
        metadata:
          toolCall: true
          reasoning: true
          modalities: { input: [text, image], output: [text] }
          limit: { context: 128000, output: 16384 }
        # per-model 运行时参数覆盖（覆盖 provider 级别 defaults）
        defaults:
          temperature: 0.7
          providerOptions:
            openai: { reasoningEffort: high }

      - id: gpt-4o-mini
        type: language
        metadata:
          toolCall: true
          limit: { context: 128000, output: 16384 }

      - id: text-embedding-3-small
        type: embedding

      - id: dall-e-3
        type: image

      - id: tts-1
        type: speech

      - id: whisper-1
        type: transcription

  anthropic:
    options:
      headers:
        anthropic-beta: interleaved-thinking-2025-05-14
    defaults:
      maxTokens: 8192
    models:
      - id: claude-sonnet-4-5
        type: language
        metadata:
          toolCall: true
          reasoning: true

      - id: claude-haiku-4
        type: language
        metadata:
          toolCall: true

  deepseek:
    defaults:
      temperature: 1.0
    models:
      - id: deepseek-chat
        type: language
        metadata:
          toolCall: true
          reasoning: true
        defaults:
          temperature: 1.3   # 覆盖 provider 级别的 1.0

      - id: deepseek-reasoner
        type: language
        metadata:
          toolCall: false
          reasoning: true
        # 未指定 per-model defaults → 继承 provider 级别 temperature: 1.0

  openai-internal:
    # 与 openai 共用同一个 @athena-ai/provider-openai 包，不同 ID
    defaults:
      maxTokens: 4096
    models:
      - id: gpt-4o
        type: language
        metadata:
          toolCall: true

# ─── 模型组（仅 language model）──────────────────────────────

groups:
  main:
    strategy: failover
    models:
      - deepseek:deepseek-chat
      - openai:gpt-4o
    circuitBreaker:
      failureThreshold: 3
      recoveryTimeout: 60

  backup:
    strategy: random
    models:
      - openai:gpt-4o
      - openai:gpt-4o-mini
    circuitBreaker:
      failureThreshold: 5
      recoveryTimeout: 120
```

---

## 七、Cortex 侧使用模式

### 7.1 简单场景（开发/测试，单模型）

```typescript
const model = ctx.ai.language();  // 使用默认 language model
const result = await streamText({ model, messages, tools, stopWhen, ... });
```

### 7.2 生产场景（failover）

```typescript
const candidates = ctx.ai.candidates(this.config.model); // "main" → group

for (const candidate of candidates) {
  try {
    const response = streamText({
      model: candidate.model,
      messages,
      tools,
      stopWhen: [stepCountIs(10)],
      prepareStep: async ({ stepNumber }) => { ... },
      maxRetries: 0,
      abortSignal,
    });

    for await (const part of response.fullStream) {
      // 消费 stream...
    }

    candidate.success();
    return response;
  } catch (e) {
    candidate.failure();
    this.ctx.logger("cortex-chat").warn(`Model ${candidate.id} failed:`, e);
    continue;
  }
}

throw new Error("All models exhausted");
```

### 7.3 使用元数据做决策

```typescript
const candidates = ctx.ai.candidates("main");

// 如果消息含图片，跳过不支持视觉的模型
const hasImage = messages.some(m => /* ... */);
const filtered = hasImage
  ? candidates.filter(c => c.metadata.modalities?.input?.includes("image"))
  : candidates;

for (const candidate of filtered) { ... }
```

---

## 八、resolve 流程详解

```
ctx.ai.candidates("main")
  │
  ├─ 不含 ':' → 查 groups
  │   └─ groups["main"] 存在
  │       └─ 按 strategy 排序 models: [deepseek:deepseek-chat, openai:gpt-4o]
  │       └─ 对每个 model:
  │           ├─ 查 providers.get("deepseek") → ProviderV4
  │           ├─ provider.languageModel("deepseek-chat") → 裸 LanguageModelV4
  │           ├─ 读 models.yml: providers.deepseek.options → headersMiddleware
  │           ├─ 读 models.yml: providers.deepseek.defaults → per-provider defaultsMiddleware
  │           ├─ 读 models.yml: deepseek-chat.defaults → per-model defaultsMiddleware（覆盖 provider 级别）
  │           ├─ wrapLanguageModel(model, [per-model defaults, per-provider defaults, headers])
  │       └─ 检查断路器：跳过 state=open 的
  │       └─ 返回 Candidate[]
  │
  ├─ 不含 ':' → groups 没有 → 查 aliases
  │   └─ aliases["fast"] = "openai:gpt-4o-mini"
  │       └─ 同单模型 resolve，返回 [Candidate]
  │
  └─ 含 ':' → 单模型
      └─ "openai:gpt-4o" → provider="openai", modelId="gpt-4o"
          ├─ providers.get("openai") → ProviderV4
          ├─ provider.languageModel("gpt-4o") → 裸 LanguageModelV4
          ├─ wrap middleware
          └─ 返回 [Candidate]
```

---

## 九、硬约束与退化测试核验

| # | 约束 | 触发？ | 说明 |
|---|------|--------|------|
| 1 | Cortex 只通过 ctx.message 访问 IM | ✅ 不触发 | 无关 |
| 2 | Cortex 依赖 capability 不依赖 nerve | ✅ 不触发 | `inject: ['ai']` 是全局 service |
| 3 | 每 Life 至多一个 Cortex | ✅ 不触发 | 不改变 |
| 4 | 无 event→response 管道 | ✅ 不触发 | 查询 service |
| 5 | Cortex 自管理缓冲 | ✅ 不触发 | 不改变 |
| 6 | 不在构造函数调 ctx.mixin() | ✅ 不触发 | 不用 mixin |
| 7 | 隔离集合 { life, cortex, message, satori } | ✅ 不触发 | 'ai' 不加入 |
| 8 | 不包装 Satori | ✅ 不触发 | 无关 |
| 9 | **不在 AI SDK 之上加 LLM 抽象层** | ✅ 不触发 | 返回 AI SDK 原生类型；使用 AI SDK middleware；不自造类型 |
| 10 | Instance 只用 cordis 标准原语 | ✅ 不触发 | Provider 是标准 cordis 插件 |

退化测试 5 条均不推向退化。

---

## 十、分阶段实施

### Phase 2-A（AI 基础设施）

1. **修 P0-1**（包名错位）——不阻塞但应先做
2. **改造 `packages/ai`**
   - 删除旧 ModelService 代码
   - 实现 `AIService extends Service<AIServiceConfig>`，provide key `"ai"`
   - Registry 基础层：`register()` / `providers()`
   - 单模型解析：`.language()` / `.embedding()` / `.image()` / `.speech()` / `.transcription()` / `.reranking()`
   - `candidates()` 统一入口（Phase 2-A 中 group 解析只返回配置中的列表，无断路器）
   - `models.yml` 加载器（YAML parse + 校验 + warnings）
   - Middleware 注入：per-model defaults + per-provider defaults + per-provider options.headers
   - 查询 API：`.default()` / `.metadata()` / `.list()`
3. **新建 provider 插件**（至少 2 个）
   - `plugins/provider-openai`
   - `plugins/provider-deepseek`
4. **补测试**
   - Provider 注册/注销
   - Provider ID 重复时抛错
   - 各模态 resolve
   - Alias 解析
   - Defaults middleware 注入验证（per-provider + per-model 优先级）
   - candidates() 单模型 / alias / group 三条路径
   - models.yml 加载（valid / invalid / missing）
   - strict / loose 模式

**验收标准**：
- `ctx.ai` 可用
- `ctx.ai.language("openai:gpt-4o")` 返回 `LanguageModelV4`
- `ctx.ai.candidates("main")` 返回 Candidate[]
- 至少 2 个 provider 注册成功
- `npx vitest run` 全绿

### Phase 2-C（cortex-chat LLM 集成时）

- 加入断路器逻辑（`Candidate.success()` / `.failure()` 实际更新状态）
- `ModelGroup.status()` / `.reset()`
- 三种策略实现：failover / round-robin / random

---

## 十一、与前端配置的关系

| 配置项 | 位置 | 前端可编辑？ | 说明 |
|--------|------|-------------|------|
| Provider id | app.yml (plugin config) | ✅ WebUI 表单 | `Schema.string().default("openai")` |
| Provider apiKey | app.yml (plugin config) | ✅ WebUI 表单 | `Schema.string().role("secret")` |
| Provider baseURL | app.yml (plugin config) | ✅ WebUI 表单 | `Schema.string()` |
| Provider options.headers | models.yml | ❌ | 配置文件中管理 |
| per-provider defaults | models.yml | ❌ | 配置文件中管理 |
| 模型声明与元数据 | models.yml | ❌ | 配置文件中管理 |
| per-model defaults | models.yml | ❌ | 配置文件中管理 |
| aliases / defaults | models.yml | ❌ | 配置文件中管理 |
| groups / 断路器 | models.yml | ❌ | 配置文件中管理 |
| Cortex 使用哪个模型 | app.yml (cortex config) | ✅ WebUI 表单 | `Schema.string()` |
| AIService configPath | app.yml (ai config) | ✅ WebUI 表单 | `Schema.string()` |

---

## 十二、新增决策摘要

| # | 决策 | 理由 |
|---|------|------|
| **D-33** | AIService 是全局单例（provide key `'ai'`），不进 isolate 集合 | AI 模型是共享无状态资源；Provider 跨模态 |
| **D-34** | Provider 插件前端配置只放凭据；headers/defaults/模型声明统一在 `models.yml` | 前端表单渲染限制；关注点分离 |
| **D-35** | `candidates()` 统一入口 + `.group()` 显式方法；Group 只做模型选择 + 断路器，不包装 SDK 调用 | 策略是 Cortex 内部的事，与 push-based 事件消费同理 |
| **D-36** | 反对运行时 npm 安装；Phase 2-A 不自建动态 Schema 前端 | 供应链安全 + 离线可用 + ROI 不足 |

---

## 十三、文档同步清单

| 文件 | 更新内容 |
|------|----------|
| `docs/02-architecture.md` §2 | 包清单：`@athena-ai/ai` 状态更新；新增 provider 包 |
| `docs/02-architecture.md` §6.1 | service token `'ai'` 确认 |
| `docs/02-architecture.md` §9 | 重写 AI 基础设施章节 |
| `docs/04-patterns-and-recipes.md` §5 | 更新 AI SDK 用法示例（candidates 模式） |
| `docs/06-progress-and-roadmap.md` §1/§3/§4 | 更新进度 |
| `docs/appendix/C-decision-index.md` | D-33 ~ D-36 |
