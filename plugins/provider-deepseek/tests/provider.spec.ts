import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { AIService } from "../../../packages/ai/src/index";
import * as ProviderDeepSeek from "../src/index";

describe("provider-deepseek", () => {
  it("registers a provider under the configured id", async () => {
    const ctx = new Context();
    await ctx.plugin(AIService, {});
    await ctx.plugin(ProviderDeepSeek, { id: "deepseek", apiKey: "test-key" });

    expect(ctx.ai.providers()).toEqual(["deepseek"]);
    expect(ctx.ai.language("deepseek:deepseek-chat").modelId).toBe("deepseek-chat");
  });

  it("coexists with another provider and unregisters cleanly", async () => {
    const ctx = new Context();
    await ctx.plugin(AIService, {});
    ctx.ai.register("openai", {
      specificationVersion: "v4",
      languageModel: () => {
        throw new Error("unused");
      },
      embeddingModel: () => {
        throw new Error("unused");
      },
      imageModel: () => {
        throw new Error("unused");
      },
    });
    const fiber = await ctx.plugin(ProviderDeepSeek, { id: "deepseek", apiKey: "test-key" });
    expect(ctx.ai.providers()).toEqual(["openai", "deepseek"]);

    await fiber.dispose();
    expect(ctx.ai.providers()).toEqual(["openai"]);
  });
});
