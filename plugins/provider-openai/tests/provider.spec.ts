import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { AIService } from "../../../packages/ai/src/index";
import * as ProviderOpenAI from "../src/index";

async function install() {
  const ctx = new Context();
  await ctx.plugin(AIService, {});
  return ctx;
}

describe("provider-openai", () => {
  it("registers a provider under the configured id", async () => {
    const ctx = await install();
    await ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "test-key" });

    expect(ctx.ai.providers()).toEqual(["openai"]);
    expect(ctx.ai.language("openai:gpt-4o").modelId).toBe("gpt-4o");
  });

  it("unregisters when the fiber is disposed", async () => {
    const ctx = await install();
    const fiber = await ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "test-key" });

    await fiber.dispose();
    expect(ctx.ai.providers()).toEqual([]);
  });

  it("supports two instances under different ids", async () => {
    const ctx = await install();
    await ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "official" });
    await ctx.plugin(ProviderOpenAI, { id: "openai-internal", apiKey: "internal", baseURL: "https://gateway.example.com/v1" });

    expect(ctx.ai.providers()).toEqual(["openai", "openai-internal"]);
  });

  it("fails the second instance that reuses an id", async () => {
    const ctx = await install();
    await ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "official" });

    await expect(ctx.plugin(ProviderOpenAI, { id: "openai", apiKey: "duplicate" })).rejects.toThrow(/already registered/);
    expect(ctx.ai.providers()).toEqual(["openai"]);
  });
});
