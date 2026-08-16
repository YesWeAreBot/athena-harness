import { readFile } from "node:fs/promises";
import { extname } from "node:path";

import { parse as parseYaml } from "yaml";

import { runtimeConfigSchema, type RuntimeConfig } from "./schema.js";

export async function loadRuntimeConfig(path: string): Promise<RuntimeConfig> {
  const raw = await readFile(path, "utf8");
  const extension = extname(path).toLowerCase();
  const parsed = extension === ".json" ? JSON.parse(raw) : parseYaml(raw);
  return parseRuntimeConfig(parsed);
}

export function parseRuntimeConfig(input: unknown): RuntimeConfig {
  return runtimeConfigSchema.parse(resolveEnv(input));
}

function resolveEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{([A-Z0-9_]+)\}/g, (match, name: string) => {
      return process.env[name] ?? match;
    });
  }
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, resolveEnv(item)]));
  }
  return value;
}
