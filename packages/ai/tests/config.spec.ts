import { afterAll, describe, expect, it } from "vitest";

import { DEFAULT_CIRCUIT_BREAKER, loadModelsConfig, parseModelsConfig } from "../src/index.ts";
import { cleanupModelsConfigs, missingConfigPath, writeModelsConfig } from "./helpers.ts";

afterAll(cleanupModelsConfigs);

describe("loadModelsConfig", () => {
  it("reads a full document from disk", () => {
    const path = writeModelsConfig(`
strict: true
defaults:
  language: deepseek:deepseek-chat
aliases:
  fast: openai:gpt-4o-mini
providers:
  openai:
    options:
      headers:
        X-Org: athena
    defaults:
      maxOutputTokens: 4096
    models:
      - id: gpt-4o
        type: language
        metadata:
          toolCall: true
          modalities: { input: [text, image], output: [text] }
          limit: { context: 128000, output: 16384 }
        defaults:
          temperature: 0.7
groups:
  main:
    strategy: round-robin
    models: [openai:gpt-4o, fast]
    circuitBreaker:
      failureThreshold: 5
      recoveryTimeout: 30
`);
    const { config, warnings, source } = loadModelsConfig(path);

    expect(warnings).toEqual([]);
    expect(source).toBe(path);
    expect(config.strict).toBe(true);
    expect(config.defaults.language).toBe("deepseek:deepseek-chat");
    expect(config.aliases).toEqual({ fast: "openai:gpt-4o-mini" });
    expect(config.providers.openai.options).toEqual({ headers: { "X-Org": "athena" } });
    expect(config.providers.openai.defaults).toEqual({ maxOutputTokens: 4096 });
    expect(config.providers.openai.models).toHaveLength(1);
    expect(config.providers.openai.models[0]).toEqual({
      id: "gpt-4o",
      type: "language",
      metadata: { toolCall: true, modalities: { input: ["text", "image"], output: ["text"] }, limit: { context: 128000, output: 16384 } },
      defaults: { temperature: 0.7 },
    });
    expect(config.groups.main).toEqual({
      strategy: "round-robin",
      models: ["openai:gpt-4o", "fast"],
      circuitBreaker: { failureThreshold: 5, recoveryTimeout: 30 },
    });
  });

  it("treats a missing implicit file as an empty registry", () => {
    const { config, warnings, source } = loadModelsConfig();
    expect(config.providers).toEqual({});
    expect(source).toBeUndefined();
    expect(warnings.some((warning) => warning.includes("empty model registry"))).toBe(true);
  });

  it("throws when an explicitly configured file is missing", () => {
    const path = missingConfigPath();
    expect(() => loadModelsConfig(path)).toThrow(/Models config not found/);
  });

  it("throws on unparseable YAML", () => {
    const path = writeModelsConfig("providers: [unclosed\n");
    expect(() => loadModelsConfig(path)).toThrow(/Failed to parse/);
  });

  it("throws when the document root is not a mapping", () => {
    const path = writeModelsConfig("- just\n- a\n- list\n");
    expect(() => loadModelsConfig(path)).toThrow(/expected a mapping at the document root/);
  });

  it("accepts an empty document", () => {
    const path = writeModelsConfig("# nothing here\n");
    const { config, warnings } = loadModelsConfig(path);
    expect(config.providers).toEqual({});
    expect(warnings).toEqual([]);
  });
});

describe("parseModelsConfig", () => {
  it("defaults a model without an explicit type to language", () => {
    const config = parseModelsConfig({ providers: { openai: { models: [{ id: "gpt-4o" }] } } });
    expect(config.providers.openai.models[0].type).toBe("language");
  });

  it("skips models with an unknown type", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ providers: { openai: { models: [{ id: "x", type: "telepathy" }] } } }, warnings);
    expect(config.providers.openai.models).toEqual([]);
    expect(warnings.some((warning) => warning.includes('unknown type "telepathy"'))).toBe(true);
  });

  it("skips models without an id and keeps the first of a duplicate pair", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig(
      {
        providers: {
          openai: { models: [{ type: "language" }, { id: "gpt-4o", metadata: { name: "first" } }, { id: "gpt-4o", metadata: { name: "second" } }] },
        },
      },
      warnings,
    );
    expect(config.providers.openai.models).toHaveLength(1);
    expect(config.providers.openai.models[0].metadata?.name).toBe("first");
    expect(warnings.some((warning) => warning.includes('missing a non-empty "id"'))).toBe(true);
    expect(warnings.some((warning) => warning.includes("duplicate model id"))).toBe(true);
  });

  it("drops settings keys the AI SDK does not accept", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ providers: { openai: { models: [{ id: "gpt-4o", defaults: { temperature: 0.5, maxTokens: 100 } }] } } }, warnings);
    expect(config.providers.openai.models[0].defaults).toEqual({ temperature: 0.5 });
    expect(warnings.some((warning) => warning.includes("maxTokens is not an AI SDK call setting"))).toBe(true);
  });

  it("rejects aliases that are not provider:model ids", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ aliases: { fast: "gpt-4o" } }, warnings);
    expect(config.aliases).toEqual({});
    expect(warnings.some((warning) => warning.includes("aliases.fast"))).toBe(true);
  });

  it("falls back to failover for an unknown group strategy", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ groups: { main: { strategy: "vibes", models: ["openai:gpt-4o"] } } }, warnings);
    expect(config.groups.main.strategy).toBe("failover");
    expect(warnings.some((warning) => warning.includes('strategy "vibes" is unknown'))).toBe(true);
  });

  it("applies default circuit breaker options and rejects non-positive overrides", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig(
      { groups: { a: { models: ["openai:gpt-4o"] }, b: { models: ["openai:gpt-4o"], circuitBreaker: { failureThreshold: 0 } } } },
      warnings,
    );
    expect(config.groups.a.circuitBreaker).toEqual(DEFAULT_CIRCUIT_BREAKER);
    expect(config.groups.b.circuitBreaker.failureThreshold).toBe(DEFAULT_CIRCUIT_BREAKER.failureThreshold);
    expect(warnings.some((warning) => warning.includes("must be a positive number"))).toBe(true);
  });

  it("skips groups without models", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ groups: { main: { strategy: "failover" } } }, warnings);
    expect(config.groups).toEqual({});
    expect(warnings.some((warning) => warning.includes("declares no models"))).toBe(true);
  });

  it("warns about unknown top-level keys", () => {
    const warnings: string[] = [];
    parseModelsConfig({ provders: {} }, warnings);
    expect(warnings.some((warning) => warning.includes('unknown top-level key "provders"'))).toBe(true);
  });

  it("ignores non-model-type keys under defaults", () => {
    const warnings: string[] = [];
    const config = parseModelsConfig({ defaults: { language: "openai:gpt-4o", telepathy: "openai:gpt-4o" } }, warnings);
    expect(config.defaults).toEqual({ language: "openai:gpt-4o" });
    expect(warnings.some((warning) => warning.includes('defaults."telepathy"'))).toBe(true);
  });
});
