import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { JsonSchema } from "./validate.js";

export type AthenaPackageKind = "mode" | "body";

export interface AthenaPackageManifest {
  readonly name: string;
  readonly version: string;
  readonly runtime?: string;
  readonly entry: string;
  readonly configSchema?: string | JsonSchema;
  readonly capabilities?: Record<string, unknown>;
  readonly kind?: AthenaPackageKind;
}

export function resolvePackageRoot(specifier: string): string {
  if (specifier.startsWith("file:")) {
    const path = fileURLToPath(specifier);
    return existsSync(path) && statSync(path).isDirectory() ? path : dirname(path);
  }
  const absolute = resolve(specifier);
  if (existsSync(absolute)) {
    return statSync(absolute).isDirectory() ? absolute : dirname(absolute);
  }
  try {
    return dirname(createRequire(import.meta.url).resolve(`${specifier}/package.json`));
  } catch {
    return absolute;
  }
}

export function loadPackageManifest(specifier: string, kind: AthenaPackageKind): AthenaPackageManifest {
  const absolute = resolve(specifier);
  if (existsSync(absolute) && statSync(absolute).isFile() && absolute.endsWith(".json")) {
    return normalizeManifest(readJson(absolute), dirname(absolute));
  }

  const root = resolvePackageRoot(specifier);
  const direct = join(root, `athena.${kind}.json`);
  if (existsSync(direct)) {
    return normalizeManifest(readJson(direct), root);
  }

  const packagePath = join(root, "package.json");
  if (existsSync(packagePath)) {
    const pkg = readJson(packagePath) as Record<string, unknown>;
    const athena = pkg.athena as Record<string, unknown> | undefined;
    const reference = typeof athena === "string" ? athena : athena?.[kind];
    if (typeof reference === "string") {
      return normalizeManifest(readJson(join(root, reference)), root);
    }
    if (reference && typeof reference === "object") {
      return normalizeManifest({ ...pkg, ...(reference as Record<string, unknown>) }, root);
    }
  }

  throw new Error(`No ${kind} package manifest found for ${specifier}`);
}

function normalizeManifest(value: Record<string, unknown>, root: string): AthenaPackageManifest {
  const name = typeof value.name === "string" ? value.name : "";
  const version = typeof value.version === "string" ? value.version : "0.0.0";
  const entry = typeof value.entry === "string" ? value.entry : "./lib/index.js";
  if (!name) throw new Error(`Athena package manifest is missing name: ${root}`);
  return {
    name,
    version,
    ...(value.runtime === undefined ? {} : { runtime: String(value.runtime) }),
    entry,
    ...(value.configSchema === undefined ? {} : { configSchema: value.configSchema as string | JsonSchema }),
    ...(value.capabilities === undefined ? {} : { capabilities: value.capabilities as Record<string, unknown> }),
    ...(value.kind === undefined ? {} : { kind: value.kind as AthenaPackageKind }),
  };
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}
