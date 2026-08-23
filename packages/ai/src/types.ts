import type { EmbeddingModelV4, ImageModelV4, LanguageModelV4, RerankingModelV4, SpeechModelV4, TranscriptionModelV4 } from "@ai-sdk/provider";
import type { defaultSettingsMiddleware } from "ai";

export type YamlValue = string | number | boolean | null | YamlValue[] | YamlMapping;
export interface YamlMapping {
  [key: string]: YamlValue;
}

export function isYamlString(value: YamlValue | undefined): value is string {
  return typeof value === "string";
}

export function isYamlNumber(value: YamlValue | undefined): value is number {
  return typeof value === "number";
}

export function isYamlBoolean(value: YamlValue | undefined): value is boolean {
  return typeof value === "boolean";
}

export function isYamlMapping(value: YamlValue | undefined): value is YamlMapping {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value);
}

export function isYamlList(value: YamlValue | undefined): value is YamlValue[] {
  return Array.isArray(value);
}

/** Modalities exposed by an AI SDK `ProviderV4`. */
export type ModelType = "language" | "embedding" | "image" | "speech" | "transcription" | "reranking";

export const MODEL_TYPES = ["language", "embedding", "image", "speech", "transcription", "reranking"] as const satisfies readonly ModelType[];

export function isModelType(value: YamlValue | undefined): value is ModelType {
  return isYamlString(value) && new Set<string>(MODEL_TYPES).has(value);
}

/** Maps a {@link ModelType} onto the native AI SDK model interface it resolves to. */
export interface ModelTypeMap {
  language: LanguageModelV4;
  embedding: EmbeddingModelV4;
  image: ImageModelV4;
  speech: SpeechModelV4;
  transcription: TranscriptionModelV4;
  reranking: RerankingModelV4;
}

/**
 * Call settings injected at resolve time. Deliberately aliased onto the AI SDK's own
 * `defaultSettingsMiddleware` parameter so the two can never drift apart.
 */
export type ModelSettings = Parameters<typeof defaultSettingsMiddleware>[0]["settings"];

/** Setting keys accepted from `models.yml`. `tools` is excluded — it cannot be expressed in YAML. */
export const SETTING_KEYS = [
  "maxOutputTokens",
  "temperature",
  "stopSequences",
  "topP",
  "topK",
  "presencePenalty",
  "frequencyPenalty",
  "responseFormat",
  "seed",
  "toolChoice",
  "headers",
  "providerOptions",
] as const satisfies ReadonlyArray<Exclude<keyof ModelSettings, "tools">>;

/** Declarative knowledge about a model, used by a Cortex to pick between candidates. */
export interface ModelMetadata {
  /** Human friendly name. */
  name?: string;
  /** Whether the model supports tool calling. */
  toolCall?: boolean;
  /** Whether the model produces reasoning content. */
  reasoning?: boolean;
  /** Supported input/output modalities, e.g. `{ input: ["text", "image"] }`. */
  modalities?: {
    input?: string[];
    output?: string[];
  };
  /** Token limits. */
  limit?: {
    context?: number;
    output?: number;
  };
}

/** A single model declaration under `providers.<id>.models`. */
export interface ModelDeclaration {
  id: string;
  type: ModelType;
  metadata?: ModelMetadata;
  defaults?: ModelSettings;
}

/** A provider section of `models.yml`. Keyed by the id the provider plugin registered with. */
export interface ProviderDeclaration {
  /** Provider-wide transport options. */
  options?: {
    headers?: Record<string, string>;
  };
  /** Provider-wide call settings; every model under the provider inherits these. */
  defaults?: ModelSettings;
  models: ModelDeclaration[];
}

export type GroupStrategy = "failover" | "round-robin" | "random";

export const GROUP_STRATEGIES = ["failover", "round-robin", "random"] as const satisfies readonly GroupStrategy[];

export interface CircuitBreakerOptions {
  /** Consecutive failures before the breaker opens. */
  failureThreshold: number;
  /** Seconds the breaker stays open before allowing a probe. */
  recoveryTimeout: number;
}

export const DEFAULT_CIRCUIT_BREAKER: CircuitBreakerOptions = { failureThreshold: 3, recoveryTimeout: 60 };

export interface CircuitBreakerStatus {
  state: "closed" | "open" | "half-open";
  failures: number;
}

/** A named group of interchangeable language models. */
export interface GroupDeclaration {
  strategy: GroupStrategy;
  models: string[];
  circuitBreaker: CircuitBreakerOptions;
}

/** Parsed `models.yml`. */
export interface ModelsConfig {
  /** Fallback model per modality, used when a resolve method is called without an argument. */
  defaults: Partial<Record<ModelType, string>>;
  /** Short name to `provider:model` mapping. */
  aliases: Record<string, string>;
  /** When true, only models declared here may be resolved. */
  strict: boolean;
  providers: Record<string, ProviderDeclaration>;
  groups: Record<string, GroupDeclaration>;
}

/**
 * One attempt in a failover loop. The model is already wrapped with the settings
 * declared in `models.yml`; `success()` / `failure()` feed the owning group's breaker.
 */
export interface Candidate {
  /** Full model id, e.g. `"openai:gpt-4o"`. */
  readonly id: string;
  /** Native AI SDK model, ready to hand to `streamText` / `generateText`. */
  readonly model: LanguageModelV4;
  /** Declared metadata; empty object when the model is undeclared and `strict` is off. */
  readonly metadata: ModelMetadata;
  /** Report that this candidate handled the call. */
  success(): void;
  /** Report that this candidate failed, so the breaker can open. */
  failure(): void;
}

/** A named group of language models plus its circuit breaker state. */
export interface ModelGroup {
  readonly name: string;
  readonly strategy: GroupStrategy;
  /** Candidates ordered by strategy, with open-breaker models filtered out. */
  candidates(): Candidate[];
  /** Breaker state per model id. */
  status(): Map<string, CircuitBreakerStatus>;
  /** Manually close a model's breaker. */
  reset(id: string): void;
}

/** A declared model, as returned by `ctx.ai.list()`. */
export interface ModelEntry {
  /** Model id as the provider knows it, e.g. `"gpt-4o"`. */
  id: string;
  type: ModelType;
  /** Registered provider id, e.g. `"openai"`. */
  provider: string;
  /** `${provider}:${id}`. */
  fullId: string;
  metadata?: ModelMetadata;
}
