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
} from "./types";

declare module "cordis" {
  interface Context {
    ai: AIService;
  }
}

export interface AIServiceConfig {
  /**
   * Path to `models.yml`. Relative paths resolve against the process working directory.
   *
   * Left unset on purpose by default: an *explicitly* configured path that does not exist is
   * fatal, while the implicit `data/models.yml` probe is optional so a fresh install still boots
   * with an empty model registry. Giving this a schema default would turn every install into the
   * explicit case and make a missing file fatal everywhere.
   */
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

type MutableModelSettings = Partial<ModelSettings>;

type ProviderOptionsValue = NonNullable<ModelSettings["providerOptions"]>[string];

/** Provider-scoped call options, keyed by provider id. */
interface ProviderOptionsMap {
  [provider: string]: ProviderOptionsValue;
}

/**
 * Merge call-setting layers, lowest priority first. Later layers win; `undefined` never overwrites.
 * Mirrors the AI SDK's own `mergeObjects` so injected defaults behave exactly like
 * `defaultSettingsMiddleware` does against runtime parameters.
 */
export function mergeSettings(...layers: Array<ModelSettings | undefined>): ModelSettings {
  const result: MutableModelSettings = {};
  for (const layer of layers) {
    if (layer) merge(result, layer);
  }
  return result;
}

/**
 * Apply one layer onto the accumulator.
 *
 * Every key is assigned explicitly rather than looped over: indexing `ModelSettings` with a
 * `keyof` variable loses the key/value correlation, and recovering it needs an assertion. The two
 * dictionary-shaped settings deep-merge (a later layer adds headers instead of replacing the set);
 * every other setting is replaced outright by the later layer.
 */
function merge(base: MutableModelSettings, overrides: ModelSettings): void {
  if (overrides.headers !== undefined) base.headers = base.headers === undefined ? overrides.headers : { ...base.headers, ...overrides.headers };
  if (overrides.providerOptions !== undefined) base.providerOptions = mergeProviderOptions(base.providerOptions, overrides.providerOptions);
  if (overrides.maxOutputTokens !== undefined) base.maxOutputTokens = overrides.maxOutputTokens;
  if (overrides.temperature !== undefined) base.temperature = overrides.temperature;
  if (overrides.stopSequences !== undefined) base.stopSequences = overrides.stopSequences;
  if (overrides.topP !== undefined) base.topP = overrides.topP;
  if (overrides.topK !== undefined) base.topK = overrides.topK;
  if (overrides.presencePenalty !== undefined) base.presencePenalty = overrides.presencePenalty;
  if (overrides.frequencyPenalty !== undefined) base.frequencyPenalty = overrides.frequencyPenalty;
  if (overrides.responseFormat !== undefined) base.responseFormat = overrides.responseFormat;
  if (overrides.seed !== undefined) base.seed = overrides.seed;
  if (overrides.toolChoice !== undefined) base.toolChoice = overrides.toolChoice;
  if (overrides.tools !== undefined) base.tools = overrides.tools;
}

/** Deep-merge provider options one level down, so two layers can contribute options to the same provider. */
function mergeProviderOptions(base: ProviderOptionsMap | undefined, overrides: ProviderOptionsMap): ProviderOptionsMap {
  if (base === undefined) return overrides;
  const result: ProviderOptionsMap = { ...base };
  for (const [provider, options] of Object.entries(overrides)) {
    const current = result[provider];
    result[provider] = current === undefined ? options : { ...current, ...options };
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
    configPath: Schema.string(),
  });

  private readonly _logger: Logger;
  private readonly _models: ModelsConfig;
  private readonly _source: string;
  private readonly _providers = new Map<string, ProviderEntry>();
  private readonly _declarations = new Map<string, DeclarationEntry>();
  private readonly _groups = new Map<string, ModelGroupImpl>();
  /** Wrapped models, keyed by `type` + full id. Cleared whenever the provider set changes. */
  private readonly _cache = new Map<string, ModelTypeMap[ModelType]>();

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
    if (id.length === 0) throw new Error("Provider id must be a non-empty string");
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
    if (input.length === 0) throw new Error("candidates() needs a model id, group name, or alias");
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
    if (cached !== undefined) {
      // SAFETY: Cache key modality guarantees the cached model matches the requested type.
      return cached as ModelTypeMap[T];
    }
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

    // SAFETY: _wrap dispatches exhaustively on type and returns the matching ModelTypeMap member.
    return this._wrap(type, entry.provider, modelId, settings) as ModelTypeMap[T];
  }

  private _wrap<T extends ModelType>(type: T, provider: ProviderV4, modelId: string, settings: ModelSettings): ModelTypeMap[T] {
    let wrapped: ModelTypeMap[ModelType];
    switch (type) {
      case "language": {
        const model = provider.languageModel(modelId);
        wrapped = Object.keys(settings).length === 0 ? model : wrapLanguageModel({ model, middleware: defaultSettingsMiddleware({ settings }) });
        break;
      }
      case "embedding": {
        const model = provider.embeddingModel(modelId);
        const transport = pickTransport(settings);
        if (!transport) {
          wrapped = model;
          break;
        }
        const middleware: EmbeddingModelV4Middleware = {
          specificationVersion: "v4",
          transformParams: async ({ params }) => ({ ...params, ...applyTransport(transport, params) }),
        };
        wrapped = wrapEmbeddingModel({ model, middleware });
        break;
      }
      case "image": {
        const model = provider.imageModel(modelId);
        const transport = pickTransport(settings);
        if (!transport) {
          wrapped = model;
          break;
        }
        const middleware: ImageModelV4Middleware = {
          specificationVersion: "v4",
          transformParams: async ({ params }) => ({ ...params, ...applyTransport(transport, params) }),
        };
        wrapped = wrapImageModel({ model, middleware });
        break;
      }
      case "speech": {
        if (!provider.speechModel) throw new Error(`Provider does not support speech models (missing speechModel())`);
        this._warnUninjectable("speech", settings);
        wrapped = provider.speechModel(modelId);
        break;
      }
      case "transcription": {
        if (!provider.transcriptionModel) throw new Error(`Provider does not support transcription models (missing transcriptionModel())`);
        this._warnUninjectable("transcription", settings);
        wrapped = provider.transcriptionModel(modelId);
        break;
      }
      case "reranking": {
        if (!provider.rerankingModel) throw new Error(`Provider does not support reranking models (missing rerankingModel())`);
        this._warnUninjectable("reranking", settings);
        wrapped = provider.rerankingModel(modelId);
        break;
      }
      default:
        throw new Error(`Unknown model type: ${type satisfies never}`);
    }
    // SAFETY: The switch exhaustively dispatches on type, so wrapped matches ModelTypeMap[T].
    return wrapped as ModelTypeMap[T];
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

interface HeaderMap {
  [key: string]: string;
}

interface Transport {
  headers: HeaderMap;
  providerOptions?: ModelSettings["providerOptions"];
}

/** Transport settings worth injecting, or `undefined` when nothing was declared. */
function pickTransport(settings: ModelSettings): Transport | undefined {
  const headers = compactHeaders(settings.headers);
  if (Object.keys(headers).length === 0 && !settings.providerOptions) return undefined;
  return { headers, providerOptions: settings.providerOptions };
}

/** AI SDK call options reject `undefined` header values, while declared settings allow them. */
function compactHeaders(headers: Record<string, string | undefined> | undefined): HeaderMap {
  const compacted: HeaderMap = {};
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
