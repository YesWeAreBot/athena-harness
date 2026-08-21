import type { EmbeddingModelV4Middleware, ImageModelV4Middleware, ProviderV4 } from "@ai-sdk/provider";
import { defaultSettingsMiddleware, wrapEmbeddingModel, wrapImageModel, wrapLanguageModel } from "ai";
import { Context, Logger, Service } from "cordis";
import Schema from "schemastery";

import { loadModelsConfig } from "./config";
import { ModelGroupImpl } from "./group";
import {
  type Candidate,
  type GroupDeclaration,
  type ModelDeclaration,
  type ModelEntry,
  type ModelGroup,
  type ModelMetadata,
  type ModelSettings,
  type ModelsConfig,
  type ModelType,
  type ModelTypeMap,
  isRecord,
} from "./types";

declare module "cordis" {
  interface Context {
    ai: AIService;
  }
}

export interface AIServiceConfig {
  /** Path to `models.yml`. Relative paths resolve against the process working directory. */
  configPath?: string;
}

interface ProviderEntry {
  id: string;
  provider: ProviderV4;
}

interface DeclarationEntry {
  provider: string;
  model: ModelDeclaration;
}

/**
 * Merge call-setting layers, lowest priority first. Later layers win; `undefined` never overwrites.
 * Mirrors the AI SDK's own `mergeObjects` so injected defaults behave exactly like
 * `defaultSettingsMiddleware` does against runtime parameters.
 */
export function mergeSettings(...layers: (ModelSettings | undefined)[]): ModelSettings {
  let result: Record<string, unknown> = {};
  for (const layer of layers) {
    if (!layer) continue;
    result = merge(result, layer as Record<string, unknown>);
  }
  return result as ModelSettings;
}

function merge(base: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...base };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? merge(current, value) : value;
  }
  return result;
}

/**
 * Provider registry and model resolver.
 *
 * Providers are plain AI SDK `ProviderV4` instances contributed by `provider-*` plugins; the
 * declarative knowledge about their models (metadata, aliases, defaults, groups) lives in
 * `models.yml`. Resolution hands back native AI SDK models with those declared defaults already
 * wrapped in, so a Cortex can pass the result straight to `streamText` / `generateText`.
 *
 * Global on purpose: models are stateless shared resources, so `ai` is deliberately *not* part of
 * the per-Life isolate set.
 */
export class AIService extends Service<AIServiceConfig> {
  public static readonly Config: Schema<AIServiceConfig> = Schema.object({
    configPath: Schema.string().default("data/models.yml"),
  });

  private readonly _logger: Logger;
  private readonly _models: ModelsConfig;
  private readonly _source: string;
  private readonly _providers = new Map<string, ProviderEntry>();
  private readonly _declarations = new Map<string, DeclarationEntry>();
  private readonly _groups = new Map<string, ModelGroupImpl>();
  /** Wrapped models, keyed by `type` + full id. Cleared whenever the provider set changes. */
  private readonly _cache = new Map<string, unknown>();

  constructor(
    ctx: Context,
    public config: AIServiceConfig,
  ) {
    super(ctx, "ai");
    this._logger = ctx.logger("ai");

    const { config: models, warnings, source } = loadModelsConfig(config.configPath);
    for (const warning of warnings) this._logger.warn(warning);
    this._models = models;
    this._source = source ?? "models.yml";

    for (const [providerId, declaration] of Object.entries(models.providers)) {
      for (const model of declaration.models) {
        this._declarations.set(`${providerId}:${model.id}`, { provider: providerId, model });
      }
    }

    for (const [name, declaration] of Object.entries(models.groups)) {
      const group = this._buildGroup(name, declaration);
      if (group) this._groups.set(name, group);
    }
  }

  // ─── Provider lifecycle ───────────────────────────────────────────────────

  /**
   * Register an AI SDK provider under `id`, returning a disposer.
   *
   * Throws on a duplicate id: two providers answering to the same name would make every
   * `provider:model` reference ambiguous. Provider plugins are `reusable`, so the fix is to give
   * the second instance a different `id` in its config.
   */
  register(id: string, provider: ProviderV4): () => void {
    if (typeof id !== "string" || id.length === 0) throw new Error("Provider id must be a non-empty string");
    if (id.includes(":")) throw new Error(`Provider id "${id}" must not contain ":" — it separates provider from model`);
    if (this._providers.has(id)) {
      const message = `Provider "${id}" is already registered; give this instance a different "id"`;
      this._logger.error(message);
      throw new Error(message);
    }

    const entry: ProviderEntry = { id, provider };
    this._providers.set(id, entry);
    this._cache.clear();
    this._logger.debug("registered provider %c", id);

    return () => {
      if (this._providers.get(id) !== entry) return;
      this._providers.delete(id);
      this._cache.clear();
    };
  }

  /** Ids of the currently registered providers. */
  providers(): string[] {
    return [...this._providers.keys()];
  }

  // ─── Single model resolution ──────────────────────────────────────────────

  /** Resolve a language model. Omit `input` to use `defaults.language`. */
  language(input?: string): ModelTypeMap["language"] {
    return this._resolveOne("language", input);
  }

  /** Resolve a text embedding model. Omit `input` to use `defaults.embedding`. */
  embedding(input?: string): ModelTypeMap["embedding"] {
    return this._resolveOne("embedding", input);
  }

  /** Resolve an image generation model. Omit `input` to use `defaults.image`. */
  image(input?: string): ModelTypeMap["image"] {
    return this._resolveOne("image", input);
  }

  /** Resolve a speech synthesis (TTS) model. Omit `input` to use `defaults.speech`. */
  speech(input?: string): ModelTypeMap["speech"] {
    return this._resolveOne("speech", input);
  }

  /** Resolve a transcription (STT) model. Omit `input` to use `defaults.transcription`. */
  transcription(input?: string): ModelTypeMap["transcription"] {
    return this._resolveOne("transcription", input);
  }

  /** Resolve a reranking model. Omit `input` to use `defaults.reranking`. */
  reranking(input?: string): ModelTypeMap["reranking"] {
    return this._resolveOne("reranking", input);
  }

  // ─── Candidates ───────────────────────────────────────────────────────────

  /**
   * Resolve `input` into the language models to try, in the order to try them.
   *
   * A value containing `:` is a concrete model. Otherwise a group is looked up first, then an
   * alias. Group candidates carry that group's circuit breaker; standalone ones report into
   * nothing, so their `success()` / `failure()` are no-ops.
   */
  candidates(input: string): Candidate[] {
    if (typeof input !== "string" || input.length === 0) throw new Error("candidates() needs a model id, group name, or alias");
    if (!input.includes(":")) {
      const group = this._groups.get(input);
      if (group) return group.candidates();
    }
    const [id] = this._targets("language", input);
    const { model, metadata } = this._resolveCandidate(id);
    return [{ id, model, metadata, success: NOOP, failure: NOOP }];
  }

  /** Look up a declared group. Throws when the name is unknown. */
  group(name: string): ModelGroup {
    const group = this._groups.get(name);
    if (!group) throw new Error(`Unknown model group "${name}" (declared in ${this._source}: ${describe([...this._groups.keys()])})`);
    return group;
  }

  // ─── Queries ──────────────────────────────────────────────────────────────

  /** The configured default model for a modality, if any. */
  default(type: ModelType): string | undefined {
    return this._models.defaults[type];
  }

  /** Declared metadata for a full model id, or `undefined` when the model is undeclared. */
  metadata(fullId: string): ModelMetadata | undefined {
    return this._declarations.get(fullId)?.model.metadata;
  }

  /** Every model declared in `models.yml`, optionally narrowed to one modality. */
  list(type?: ModelType): ModelEntry[] {
    const entries: ModelEntry[] = [];
    for (const [fullId, { provider, model }] of this._declarations) {
      if (type !== undefined && model.type !== type) continue;
      entries.push({ id: model.id, type: model.type, provider, fullId, metadata: model.metadata });
    }
    return entries;
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  private _buildGroup(name: string, declaration: GroupDeclaration): ModelGroupImpl | undefined {
    const models: string[] = [];
    for (const member of declaration.models) {
      try {
        models.push(this._normalize(member));
      } catch (error) {
        this._logger.warn(`Group "${name}": dropping member "${member}":`, error);
      }
    }
    if (models.length === 0) {
      this._logger.warn(`Group "${name}" has no resolvable members; skipped`);
      return undefined;
    }
    return new ModelGroupImpl(name, { ...declaration, models }, (id) => this._resolveCandidate(id), this._logger);
  }

  private _resolveCandidate(id: string): Pick<Candidate, "model" | "metadata"> {
    return { model: this._model("language", id), metadata: this.metadata(id) ?? {} };
  }

  private _resolveOne<T extends ModelType>(type: T, input?: string): ModelTypeMap[T] {
    const [first] = this._targets(type, input);
    return this._model(type, first);
  }

  /**
   * Expand a user-facing reference into concrete `provider:model` ids.
   * A group expands to all its members; everything else yields exactly one id.
   */
  private _targets(type: ModelType, input?: string): string[] {
    const raw = input ?? this._models.defaults[type];
    if (!raw) throw new Error(`No ${type} model requested and no "defaults.${type}" declared in ${this._source}`);

    const group = raw.includes(":") ? undefined : this._groups.get(raw);
    if (!group) return [this._normalize(raw)];
    if (type !== "language") throw new Error(`"${raw}" is a model group; groups hold language models and cannot resolve a ${type} model`);
    return group.models;
  }

  /** Resolve a single reference — full id or alias — into `provider:model`. Groups are rejected. */
  private _normalize(raw: string): string {
    if (raw.includes(":")) return raw;
    const alias = this._models.aliases[raw];
    if (alias) return alias;
    const hint = this._models.groups[raw] ? `; "${raw}" is a group and groups cannot be nested` : "";
    throw new Error(
      `Cannot resolve "${raw}": expected "provider:model" or an alias declared in ${this._source}${hint}${hint ? "" : ` (aliases: ${describe(Object.keys(this._models.aliases))})`}`,
    );
  }

  private _model<T extends ModelType>(type: T, fullId: string): ModelTypeMap[T] {
    const key = `${type}\u0000${fullId}`;
    const cached = this._cache.get(key);
    if (cached !== undefined) return cached as ModelTypeMap[T];
    const model = this._create(type, fullId);
    this._cache.set(key, model);
    return model;
  }

  private _create<T extends ModelType>(type: T, fullId: string): ModelTypeMap[T] {
    const separator = fullId.indexOf(":");
    if (separator <= 0 || separator === fullId.length - 1) throw new Error(`Malformed model id "${fullId}"; expected "provider:model"`);
    const providerId = fullId.slice(0, separator);
    const modelId = fullId.slice(separator + 1);

    const entry = this._providers.get(providerId);
    if (!entry) throw new Error(`Provider "${providerId}" is not registered (registered: ${describe(this.providers())})`);

    const declared = this._declarations.get(fullId);
    if (!declared && this._models.strict) throw new Error(`Model "${fullId}" is not declared in ${this._source} and strict mode is on`);
    if (declared && declared.model.type !== type) throw new Error(`Model "${fullId}" is declared as "${declared.model.type}", not "${type}"`);

    const settings = mergeSettings(
      { headers: this._models.providers[providerId]?.options?.headers },
      this._models.providers[providerId]?.defaults,
      declared?.model.defaults,
    );

    // The switch narrows `type` at runtime but TS cannot tie that back to `ModelTypeMap[T]`.
    return this._wrap(type, entry.provider, modelId, settings) as ModelTypeMap[T];
  }

  private _wrap(type: ModelType, provider: ProviderV4, modelId: string, settings: ModelSettings): unknown {
    switch (type) {
      case "language": {
        const model = provider.languageModel(modelId);
        if (Object.keys(settings).length === 0) return model;
        return wrapLanguageModel({ model, middleware: defaultSettingsMiddleware({ settings }) });
      }
      case "embedding": {
        const model = provider.embeddingModel(modelId);
        const transport = pickTransport(settings);
        if (!transport) return model;
        const middleware: EmbeddingModelV4Middleware = {
          specificationVersion: "v4",
          transformParams: async ({ params }) => ({ ...params, ...applyTransport(transport, params) }),
        };
        return wrapEmbeddingModel({ model, middleware });
      }
      case "image": {
        const model = provider.imageModel(modelId);
        const transport = pickTransport(settings);
        if (!transport) return model;
        const middleware: ImageModelV4Middleware = {
          specificationVersion: "v4",
          transformParams: async ({ params }) => ({ ...params, ...applyTransport(transport, params) }),
        };
        return wrapImageModel({ model, middleware });
      }
      case "speech": {
        if (!provider.speechModel) throw new Error(`Provider does not support speech models (missing speechModel())`);
        this._warnUninjectable("speech", settings);
        return provider.speechModel(modelId);
      }
      case "transcription": {
        if (!provider.transcriptionModel) throw new Error(`Provider does not support transcription models (missing transcriptionModel())`);
        this._warnUninjectable("transcription", settings);
        return provider.transcriptionModel(modelId);
      }
      case "reranking": {
        if (!provider.rerankingModel) throw new Error(`Provider does not support reranking models (missing rerankingModel())`);
        this._warnUninjectable("reranking", settings);
        return provider.rerankingModel(modelId);
      }
    }
  }

  /** The AI SDK ships no settings middleware for these modalities, so declared defaults cannot be injected. */
  private _warnUninjectable(type: ModelType, settings: ModelSettings): void {
    if (!pickTransport(settings)) return;
    this._logger.debug("declared headers/providerOptions are not injected for %c models; pass them at call time", type);
  }
}

const NOOP = () => {};

function describe(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

interface Transport {
  headers: Record<string, string>;
  providerOptions?: ModelSettings["providerOptions"];
}

/** Transport settings worth injecting, or `undefined` when nothing was declared. */
function pickTransport(settings: ModelSettings): Transport | undefined {
  const headers = compactHeaders(settings.headers);
  if (Object.keys(headers).length === 0 && !settings.providerOptions) return undefined;
  return { headers, providerOptions: settings.providerOptions };
}

/** AI SDK call options reject `undefined` header values, while declared settings allow them. */
function compactHeaders(headers: Record<string, string | undefined> | undefined): Record<string, string> {
  const compacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (value !== undefined) compacted[key] = value;
  }
  return compacted;
}

/** Layer declared transport settings underneath whatever the caller already passed. */
function applyTransport(
  transport: Transport,
  params: { headers?: Record<string, string | undefined>; providerOptions?: ModelSettings["providerOptions"] },
): Transport {
  return {
    headers: { ...transport.headers, ...compactHeaders(params.headers) },
    providerOptions: mergeSettings({ providerOptions: transport.providerOptions }, { providerOptions: params.providerOptions }).providerOptions,
  };
}

export { AIService as default };
