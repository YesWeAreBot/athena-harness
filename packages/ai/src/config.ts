import { existsSync, readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  DEFAULT_CIRCUIT_BREAKER,
  GROUP_STRATEGIES,
  type CircuitBreakerOptions,
  type GroupDeclaration,
  type GroupStrategy,
  type ModelDeclaration,
  type ModelMetadata,
  type ModelSettings,
  type ModelsConfig,
  type ProviderDeclaration,
  SETTING_KEYS,
  isModelType,
  isRecord,
} from "./types";

/** Path probed when `AIServiceConfig.configPath` is omitted. */
export const DEFAULT_CONFIG_PATH = "data/models.yml";

export interface ModelsConfigLoadResult {
  config: ModelsConfig;
  /** Non-fatal problems: unknown keys, malformed entries that were skipped. */
  warnings: string[];
  /** Absolute path that was read, or `undefined` when no file was found. */
  source?: string;
}

export function emptyModelsConfig(): ModelsConfig {
  return { defaults: {}, aliases: {}, strict: false, providers: {}, groups: {} };
}

/**
 * Read and validate `models.yml`.
 *
 * A missing file is fatal only when the path was configured explicitly — the implicit
 * `./models.yml` is optional so that a fresh install still boots with an empty registry.
 * Unparseable YAML and a non-object document are always fatal; anything narrower is
 * reported through `warnings` and skipped.
 */
export function loadModelsConfig(configPath?: string): ModelsConfigLoadResult {
  const warnings: string[] = [];
  const filePath = resolvePath(configPath ?? DEFAULT_CONFIG_PATH);

  if (!existsSync(filePath)) {
    if (configPath !== undefined) throw new Error(`Models config not found: ${filePath}`);
    warnings.push(`No ${DEFAULT_CONFIG_PATH} found at ${filePath}; starting with an empty model registry`);
    return { config: emptyModelsConfig(), warnings };
  }

  let document: unknown;
  try {
    document = parseYaml(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${filePath}: ${(error as Error).message}`);
  }

  return { config: parseModelsConfig(document, warnings, filePath), warnings, source: filePath };
}

/** Validate an already-parsed `models.yml` document. Exported so callers can supply config inline. */
export function parseModelsConfig(document: unknown, warnings: string[] = [], label = "models config"): ModelsConfig {
  const config = emptyModelsConfig();
  if (document === null || document === undefined) return config;
  if (!isRecord(document)) throw new Error(`${label}: expected a mapping at the document root`);

  config.strict = readStrict(document.strict, warnings, label);
  readDefaults(document.defaults, config, warnings, label);
  readAliases(document.aliases, config, warnings, label);
  readProviders(document.providers, config, warnings, label);
  readGroups(document.groups, config, warnings, label);

  for (const key of Object.keys(document)) {
    if (!["strict", "defaults", "aliases", "providers", "groups"].includes(key)) {
      warnings.push(`${label}: unknown top-level key "${key}"`);
    }
  }

  return config;
}

function readStrict(value: unknown, warnings: string[], label: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "boolean") return value;
  warnings.push(`${label}: "strict" must be a boolean, got ${typeof value}; treating as false`);
  return false;
}

function readDefaults(value: unknown, config: ModelsConfig, warnings: string[], label: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    warnings.push(`${label}: "defaults" must be a mapping; ignored`);
    return;
  }
  for (const [type, target] of Object.entries(value)) {
    if (!isModelType(type)) {
      warnings.push(`${label}: defaults."${type}" is not a known model type; ignored`);
      continue;
    }
    if (typeof target !== "string" || target.length === 0) {
      warnings.push(`${label}: defaults.${type} must be a non-empty string; ignored`);
      continue;
    }
    if (!target.includes(":")) {
      warnings.push(`${label}: defaults.${type} = "${target}" is not a "provider:model" id; it must resolve through aliases or groups`);
    }
    config.defaults[type] = target;
  }
}

function readAliases(value: unknown, config: ModelsConfig, warnings: string[], label: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    warnings.push(`${label}: "aliases" must be a mapping; ignored`);
    return;
  }
  for (const [alias, target] of Object.entries(value)) {
    if (typeof target !== "string" || target.length === 0) {
      warnings.push(`${label}: aliases.${alias} must be a non-empty string; ignored`);
      continue;
    }
    if (!target.includes(":")) {
      warnings.push(`${label}: aliases.${alias} = "${target}" is not a "provider:model" id; ignored`);
      continue;
    }
    config.aliases[alias] = target;
  }
}

function readProviders(value: unknown, config: ModelsConfig, warnings: string[], label: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    warnings.push(`${label}: "providers" must be a mapping; ignored`);
    return;
  }
  for (const [providerId, raw] of Object.entries(value)) {
    if (!isRecord(raw)) {
      warnings.push(`${label}: providers.${providerId} must be a mapping; ignored`);
      continue;
    }
    const declaration: ProviderDeclaration = { models: [] };
    const headers = readHeaders(isRecord(raw.options) ? raw.options.headers : undefined, `${label}: providers.${providerId}.options.headers`, warnings);
    if (headers) declaration.options = { headers };
    const defaults = readSettings(raw.defaults, `${label}: providers.${providerId}.defaults`, warnings);
    if (defaults) declaration.defaults = defaults;
    declaration.models = readModels(raw.models, providerId, warnings, label);
    config.providers[providerId] = declaration;
  }
}

function readModels(value: unknown, providerId: string, warnings: string[], label: string): ModelDeclaration[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${label}: providers.${providerId}.models must be a list; ignored`);
    return [];
  }
  const models: ModelDeclaration[] = [];
  const seen = new Set<string>();
  for (const [index, raw] of value.entries()) {
    const where = `${label}: providers.${providerId}.models[${index}]`;
    if (!isRecord(raw)) {
      warnings.push(`${where} must be a mapping; skipped`);
      continue;
    }
    if (typeof raw.id !== "string" || raw.id.length === 0) {
      warnings.push(`${where} is missing a non-empty "id"; skipped`);
      continue;
    }
    if (seen.has(raw.id)) {
      warnings.push(`${where}: duplicate model id "${raw.id}"; keeping the first declaration`);
      continue;
    }
    if (raw.type !== undefined && !isModelType(raw.type)) {
      warnings.push(`${where}: unknown type "${String(raw.type)}"; skipped`);
      continue;
    }
    const declaration: ModelDeclaration = { id: raw.id, type: raw.type === undefined ? "language" : (raw.type as ModelDeclaration["type"]) };
    const metadata = readMetadata(raw.metadata, `${where}.metadata`, warnings);
    if (metadata) declaration.metadata = metadata;
    const defaults = readSettings(raw.defaults, `${where}.defaults`, warnings);
    if (defaults) declaration.defaults = defaults;
    seen.add(raw.id);
    models.push(declaration);
  }
  return models;
}

function readMetadata(value: unknown, where: string, warnings: string[]): ModelMetadata | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    warnings.push(`${where} must be a mapping; ignored`);
    return undefined;
  }
  const metadata: ModelMetadata = {};
  if (typeof value.name === "string") metadata.name = value.name;
  if (typeof value.toolCall === "boolean") metadata.toolCall = value.toolCall;
  if (typeof value.reasoning === "boolean") metadata.reasoning = value.reasoning;

  if (isRecord(value.modalities)) {
    const input = readStringList(value.modalities.input, `${where}.modalities.input`, warnings);
    const output = readStringList(value.modalities.output, `${where}.modalities.output`, warnings);
    if (input || output) metadata.modalities = { ...(input && { input }), ...(output && { output }) };
  } else if (value.modalities !== undefined) {
    warnings.push(`${where}.modalities must be a mapping; ignored`);
  }

  if (isRecord(value.limit)) {
    const context = typeof value.limit.context === "number" ? value.limit.context : undefined;
    const output = typeof value.limit.output === "number" ? value.limit.output : undefined;
    if (context !== undefined || output !== undefined) {
      metadata.limit = { ...(context !== undefined && { context }), ...(output !== undefined && { output }) };
    }
  } else if (value.limit !== undefined) {
    warnings.push(`${where}.limit must be a mapping; ignored`);
  }

  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function readStringList(value: unknown, where: string, warnings: string[]): string[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    warnings.push(`${where} must be a list of strings; ignored`);
    return undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  if (items.length !== value.length) warnings.push(`${where} contains non-string entries; they were dropped`);
  return items.length > 0 ? items : undefined;
}

function readHeaders(value: unknown, where: string, warnings: string[]): Record<string, string> | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    warnings.push(`${where} must be a mapping; ignored`);
    return undefined;
  }
  const headers: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") headers[key] = item;
    else if (typeof item === "number" || typeof item === "boolean") headers[key] = String(item);
    else warnings.push(`${where}.${key} must be a scalar; ignored`);
  }
  return Object.keys(headers).length > 0 ? headers : undefined;
}

/** Pick the AI SDK call settings out of a `defaults` block, dropping anything unrecognised. */
function readSettings(value: unknown, where: string, warnings: string[]): ModelSettings | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    warnings.push(`${where} must be a mapping; ignored`);
    return undefined;
  }
  const settings: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!(SETTING_KEYS as readonly string[]).includes(key)) {
      warnings.push(`${where}.${key} is not an AI SDK call setting; ignored (allowed: ${SETTING_KEYS.join(", ")})`);
      continue;
    }
    if (key === "headers") {
      const headers = readHeaders(item, `${where}.headers`, warnings);
      if (headers) settings.headers = headers;
      continue;
    }
    if (item !== undefined && item !== null) settings[key] = item;
  }
  return Object.keys(settings).length > 0 ? (settings as ModelSettings) : undefined;
}

function readGroups(value: unknown, config: ModelsConfig, warnings: string[], label: string): void {
  if (value === undefined || value === null) return;
  if (!isRecord(value)) {
    warnings.push(`${label}: "groups" must be a mapping; ignored`);
    return;
  }
  for (const [name, raw] of Object.entries(value)) {
    const where = `${label}: groups.${name}`;
    if (!isRecord(raw)) {
      warnings.push(`${where} must be a mapping; ignored`);
      continue;
    }
    const models = readStringList(raw.models, `${where}.models`, warnings);
    if (!models) {
      warnings.push(`${where} declares no models; ignored`);
      continue;
    }
    let strategy: GroupStrategy = "failover";
    if (raw.strategy !== undefined) {
      if ((GROUP_STRATEGIES as readonly string[]).includes(raw.strategy as string)) strategy = raw.strategy as GroupStrategy;
      else warnings.push(`${where}.strategy "${String(raw.strategy)}" is unknown; using "failover" (allowed: ${GROUP_STRATEGIES.join(", ")})`);
    }
    const declaration: GroupDeclaration = { strategy, models, circuitBreaker: readCircuitBreaker(raw.circuitBreaker, `${where}.circuitBreaker`, warnings) };
    config.groups[name] = declaration;
  }
}

function readCircuitBreaker(value: unknown, where: string, warnings: string[]): CircuitBreakerOptions {
  if (value === undefined || value === null) return { ...DEFAULT_CIRCUIT_BREAKER };
  if (!isRecord(value)) {
    warnings.push(`${where} must be a mapping; using defaults`);
    return { ...DEFAULT_CIRCUIT_BREAKER };
  }
  const options = { ...DEFAULT_CIRCUIT_BREAKER };
  for (const key of ["failureThreshold", "recoveryTimeout"] as const) {
    const item = value[key];
    if (item === undefined || item === null) continue;
    if (typeof item !== "number" || !Number.isFinite(item) || item <= 0) {
      warnings.push(`${where}.${key} must be a positive number; using ${options[key]}`);
      continue;
    }
    options[key] = item;
  }
  return options;
}
