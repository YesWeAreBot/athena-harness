import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import type { BodyAdapter, Mode, ModePipeline } from "@yesimbot/athena-runtime";

import { loadPackageManifest, resolvePackageRoot, type AthenaPackageManifest } from "./manifest.js";
import { satisfiesVersion, validateJsonSchema, type JsonSchema } from "./validate.js";

const RUNTIME_VERSION = "0.0.0";

export interface LoadedModePackage {
  readonly manifest: AthenaPackageManifest;
  readonly mode: Mode;
  readonly pipeline?: ModePipeline;
  readonly config: unknown;
}

export interface LoadedBodyPackage {
  readonly manifest: AthenaPackageManifest;
  readonly createAdapter: (config: unknown) => BodyAdapter;
  readonly config: unknown;
}

export async function loadModePackage(specifier: string, config: unknown = {}): Promise<LoadedModePackage> {
  const manifest = loadPackageManifest(specifier, "mode");
  const root = resolvePackageRoot(specifier);
  assertRuntime(manifest);
  const schema = loadSchema(manifest, root);
  const errors = validateJsonSchema(config, schema);
  if (errors.length > 0) throw new Error(`Invalid config for ${manifest.name}: ${errors.join("; ")}`);

  const entry = await import(await resolveEntry(root, manifest));
  const loaded = entry.default ?? entry;
  const mode = isMode(loaded) ? loaded : loaded.mode;
  if (!mode) throw new Error(`Mode package ${manifest.name} does not export a Mode entry`);
  return {
    manifest,
    mode: mode as Mode,
    ...(loaded.pipeline === undefined ? {} : { pipeline: loaded.pipeline as ModePipeline }),
    config,
  };
}

export async function loadBodyPackage(specifier: string, config: unknown = {}): Promise<LoadedBodyPackage> {
  const manifest = loadPackageManifest(specifier, "body");
  const root = resolvePackageRoot(specifier);
  assertRuntime(manifest);
  const schema = loadSchema(manifest, root);
  const errors = validateJsonSchema(config, schema);
  if (errors.length > 0) throw new Error(`Invalid config for ${manifest.name}: ${errors.join("; ")}`);

  const entry = await import(await resolveEntry(root, manifest));
  const loaded = entry.default ?? entry;
  const createAdapter = typeof loaded === "function" ? loaded : loaded.createBodyAdapter;
  if (typeof createAdapter !== "function") throw new Error(`Body package ${manifest.name} does not export a Body adapter factory`);
  return {
    manifest,
    createAdapter: createAdapter as (config: unknown) => BodyAdapter,
    config,
  };
}

function isMode(value: unknown): value is Mode {
  return Boolean(value && typeof value === "object" && "name" in value && "setup" in value);
}

function assertRuntime(manifest: AthenaPackageManifest): void {
  if (!satisfiesVersion(RUNTIME_VERSION, manifest.runtime)) {
    throw new Error(`${manifest.name} requires Athena Runtime ${manifest.runtime}; current is ${RUNTIME_VERSION}`);
  }
}

function loadSchema(manifest: AthenaPackageManifest, root: string): JsonSchema | undefined {
  if (typeof manifest.configSchema !== "string") return manifest.configSchema;
  return JSON.parse(readFileSync(join(root, manifest.configSchema), "utf8")) as JsonSchema;
}

async function resolveEntry(root: string, manifest: AthenaPackageManifest): Promise<string> {
  if (manifest.entry.startsWith(".") || isAbsolute(manifest.entry) || manifest.entry.startsWith("file:")) {
    return pathToFileURL(join(root, manifest.entry)).href;
  }
  try {
    return createRequire(import.meta.url).resolve(manifest.entry);
  } catch {
    return resolve(root, manifest.entry);
  }
}
