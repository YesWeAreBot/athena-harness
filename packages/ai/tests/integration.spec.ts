import { Context } from "cordis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import * as ProviderDeepSeek from "../../../plugins/provider-deepseek/src/index.ts";
import * as ProviderOpenAI from "../../../plugins/provider-openai/src/index.ts";
import { AIService } from "../src/index.ts";
import { cleanupModelsConfigs, writeModelsConfig } from "./helpers.ts";

afterAll(cleanupModelsConfigs);

/**
 * End-to-end shape of a real deployment: `models.yml` plus two real provider plugins.
 * No network — nothing here calls a model, only resolves one.
 */
const YAML = `
defaults:
  language: deepseek:deepseek-chat
  embedding: openai:text-embedding-3-small

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
        metadata:
          toolCall: true
          modalities: { input: [text, image], output: [text] }
        defaults:
          temperature: 0.7
      - id: gpt-4o-mini
        metadata: { toolCall: true }
      - id: text-embedding-3-small
        type: embedding

  deepseek:
    defaults:
      temperature: 1
    models:
      - id: deepseek-chat
        metadata: { toolCall: true, reasoning: true }
      - id: deepseek-reasoner
        metadata: { toolCall: false, reasoning: true }

groups:
  main:
    strategy: failover
    models: [deepseek:deepseek-chat, openai:gpt-4o, fast]
    circuitBreaker:
      failureThreshold: 1
      recoveryTimeout: 600
`;

let ctx: Context;

beforeAll(async () => {
  ctx = new Context();
  await ctx.plugin(AIService, { configPath: writeModelsConfig(YAML) });
  await ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "test-openai" });
  await ctx.plugin(ProviderDeepSeek, { id: "deepseek", apiKey: "test-deepseek" });
});

describe("AIService with real provider plugins", () => {
  it("registers both providers", () => {
    expect(ctx.ai.providers()).toEqual(["openai", "deepseek"]);
  });

  it("resolves declared models across providers and modalities", () => {
    expect(ctx.ai.language("openai:gpt-4o").modelId).toBe("gpt-4o");
    expect(ctx.ai.language("deepseek:deepseek-reasoner").modelId).toBe("deepseek-reasoner");
    expect(ctx.ai.embedding().modelId).toBe("text-embedding-3-small");
    expect(ctx.ai.language().modelId).toBe("deepseek-chat");
    expect(ctx.ai.language("fast").modelId).toBe("gpt-4o-mini");
  });

  it("keeps the provider identity through the settings wrapper", () => {
    // gpt-4o has declared defaults, so it comes back wrapped; gpt-4o-mini inherits only
    // provider-level defaults, which still counts as declared settings.
    const wrapped = ctx.ai.language("openai:gpt-4o");
    expect(wrapped.provider).toContain("openai");
    expect(wrapped.specificationVersion).toBe("v4");
  });

  it("lists every declared model", () => {
    expect(ctx.ai.list().map((entry) => entry.fullId)).toEqual([
      "openai:gpt-4o",
      "openai:gpt-4o-mini",
      "openai:text-embedding-3-small",
      "deepseek:deepseek-chat",
      "deepseek:deepseek-reasoner",
    ]);
    expect(ctx.ai.list("embedding").map((entry) => entry.fullId)).toEqual(["openai:text-embedding-3-small"]);
  });

  it("builds a failover group spanning both providers, aliases normalised", () => {
    const candidates = ctx.ai.candidates("main");
    expect(candidates.map((candidate) => candidate.id)).toEqual(["deepseek:deepseek-chat", "openai:gpt-4o", "openai:gpt-4o-mini"]);
    expect(candidates[0].metadata).toEqual({ toolCall: true, reasoning: true });
    expect(candidates[1].metadata.modalities?.input).toEqual(["text", "image"]);
  });

  it("lets a Cortex filter candidates by declared metadata", () => {
    const visionCapable = ctx.ai.candidates("main").filter((candidate) => candidate.metadata.modalities?.input?.includes("image"));
    expect(visionCapable.map((candidate) => candidate.id)).toEqual(["openai:gpt-4o"]);
  });

  it("drops a failing candidate from the group and reports it", () => {
    const group = ctx.ai.group("main");
    group.candidates()[0].failure();

    expect(group.status().get("deepseek:deepseek-chat")).toEqual({ state: "open", failures: 1 });
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["openai:gpt-4o", "openai:gpt-4o-mini"]);

    group.reset("deepseek:deepseek-chat");
    expect(group.candidates()).toHaveLength(3);
  });
});
