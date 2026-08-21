import type { ProviderV4 } from "@ai-sdk/provider";
import { MockEmbeddingModelV4, MockLanguageModelV4, MockProviderV4, MockSpeechModelV4 } from "ai/test";
import { Context } from "cordis";
import { afterAll, describe, expect, it } from "vitest";

import { AIService } from "../src/index";
import { cleanupModelsConfigs, writeModelsConfig } from "./helpers";

afterAll(cleanupModelsConfigs);

const GENERATE_RESULT = {
  content: [{ type: "text" as const, text: "ok" }],
  finishReason: "stop" as const,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: [],
};

const USER_PROMPT = [{ role: "user" as const, content: [{ type: "text" as const, text: "hi" }] }];

function mockProvider() {
  const chat = new MockLanguageModelV4({ modelId: "chat", doGenerate: GENERATE_RESULT });
  const embed = new MockEmbeddingModelV4({ modelId: "embed", doEmbed: { embeddings: [[0.1]] } });
  const speak = new MockSpeechModelV4({ modelId: "speak" });
  const provider = new MockProviderV4({
    languageModels: { chat, other: new MockLanguageModelV4({ modelId: "other", doGenerate: GENERATE_RESULT }) },
    embeddingModels: { embed },
    speechModels: { speak },
  });
  return { provider, chat, embed, speak };
}

/** Install AIService against an inline `models.yml`, plus any providers to register. */
async function harness(yaml: string, providers: Record<string, ProviderV4> = {}) {
  const ctx = new Context();
  await ctx.plugin(AIService, { configPath: writeModelsConfig(yaml) });
  for (const [id, provider] of Object.entries(providers)) ctx.ai.register(id, provider);
  return ctx;
}

describe("AIService registry", () => {
  it("provides ctx.ai when installed", async () => {
    const ctx = await harness("");
    expect(ctx.ai).toBeInstanceOf(AIService);
    expect(ctx.ai.providers()).toEqual([]);
  });

  it("registers and unregisters providers", async () => {
    const ctx = await harness("");
    const { provider } = mockProvider();
    const dispose = ctx.ai.register("mock", provider);
    expect(ctx.ai.providers()).toEqual(["mock"]);
    dispose();
    expect(ctx.ai.providers()).toEqual([]);
  });

  it("rejects a duplicate provider id", async () => {
    const ctx = await harness("");
    ctx.ai.register("mock", mockProvider().provider);
    expect(() => ctx.ai.register("mock", mockProvider().provider)).toThrow(/already registered/);
    expect(ctx.ai.providers()).toEqual(["mock"]);
  });

  it("rejects ids that are empty or contain a colon", async () => {
    const ctx = await harness("");
    expect(() => ctx.ai.register("", mockProvider().provider)).toThrow(/non-empty string/);
    expect(() => ctx.ai.register("a:b", mockProvider().provider)).toThrow(/must not contain ":"/);
  });

  it("a stale disposer does not remove a re-registered provider", async () => {
    const ctx = await harness("");
    const first = mockProvider().provider;
    const dispose = ctx.ai.register("mock", first);
    dispose();
    ctx.ai.register("mock", mockProvider().provider);
    dispose();
    expect(ctx.ai.providers()).toEqual(["mock"]);
  });
});

describe("AIService resolve", () => {
  it("resolves a fully qualified id per modality", async () => {
    const { provider, chat, embed, speak } = mockProvider();
    const ctx = await harness("", { mock: provider });
    expect(ctx.ai.language("mock:chat")).toBe(chat);
    expect(ctx.ai.embedding("mock:embed")).toBe(embed);
    expect(ctx.ai.speech("mock:speak")).toBe(speak);
  });

  it("caches resolved models until the provider set changes", async () => {
    const { provider } = mockProvider();
    const ctx = await harness(
      `
providers:
  mock:
    models:
      - id: chat
        defaults: { temperature: 0.5 }
`,
      { mock: provider },
    );
    const first = ctx.ai.language("mock:chat");
    expect(ctx.ai.language("mock:chat")).toBe(first);
    ctx.ai.register("other", mockProvider().provider);
    expect(ctx.ai.language("mock:chat")).not.toBe(first);
  });

  it("throws for an unregistered provider", async () => {
    const ctx = await harness("");
    expect(() => ctx.ai.language("nope:chat")).toThrow(/Provider "nope" is not registered/);
  });

  it("throws for a malformed id", async () => {
    const ctx = await harness("", { mock: mockProvider().provider });
    expect(() => ctx.ai.language("mock:")).toThrow(/Malformed model id/);
    expect(() => ctx.ai.language(":chat")).toThrow(/Malformed model id/);
  });

  it("splits on the first colon so model ids may contain colons", async () => {
    const chat = new MockLanguageModelV4({ modelId: "llama3:8b", doGenerate: GENERATE_RESULT });
    const ctx = await harness("", { ollama: new MockProviderV4({ languageModels: { "llama3:8b": chat } }) });
    expect(ctx.ai.language("ollama:llama3:8b")).toBe(chat);
  });

  it("throws when the provider lacks the requested modality", async () => {
    const bare: ProviderV4 = {
      specificationVersion: "v4",
      languageModel: () => new MockLanguageModelV4({ doGenerate: GENERATE_RESULT }),
      embeddingModel: () => new MockEmbeddingModelV4({ doEmbed: { embeddings: [[0]] } }),
      imageModel: () => {
        throw new Error("no image models");
      },
    };
    const ctx = await harness("", { bare });
    expect(() => ctx.ai.reranking("bare:whatever")).toThrow(/does not support reranking models/);
  });

  it("rejects a modality mismatch against the declaration", async () => {
    const ctx = await harness(
      `
providers:
  mock:
    models:
      - id: embed
        type: embedding
`,
      { mock: mockProvider().provider },
    );
    expect(() => ctx.ai.language("mock:embed")).toThrow(/is declared as "embedding", not "language"/);
  });
});

describe("AIService defaults and aliases", () => {
  const YAML = `
defaults:
  language: mock:chat
aliases:
  fast: mock:other
providers:
  mock:
    models:
      - id: chat
      - id: other
`;

  it("uses defaults when no input is given", async () => {
    const { provider, chat } = mockProvider();
    const ctx = await harness(YAML, { mock: provider });
    expect(ctx.ai.default("language")).toBe("mock:chat");
    expect(ctx.ai.language()).toBe(chat);
  });

  it("throws when no input is given and no default is declared", async () => {
    const ctx = await harness("", { mock: mockProvider().provider });
    expect(() => ctx.ai.language()).toThrow(/no "defaults.language" declared/);
  });

  it("resolves an alias", async () => {
    const ctx = await harness(YAML, { mock: mockProvider().provider });
    expect(ctx.ai.language("fast").modelId).toBe("other");
  });

  it("throws for a reference that is neither an id nor an alias", async () => {
    const ctx = await harness(YAML, { mock: mockProvider().provider });
    expect(() => ctx.ai.language("smart")).toThrow(/Cannot resolve "smart"/);
  });

  it("lists declared models and their metadata", async () => {
    const ctx = await harness(
      `
providers:
  mock:
    models:
      - id: chat
        metadata: { toolCall: true }
      - id: embed
        type: embedding
`,
      { mock: mockProvider().provider },
    );
    expect(ctx.ai.list().map((entry) => entry.fullId)).toEqual(["mock:chat", "mock:embed"]);
    expect(ctx.ai.list("embedding")).toEqual([{ id: "embed", type: "embedding", provider: "mock", fullId: "mock:embed", metadata: undefined }]);
    expect(ctx.ai.metadata("mock:chat")).toEqual({ toolCall: true });
    expect(ctx.ai.metadata("mock:missing")).toBeUndefined();
  });
});

describe("AIService strict mode", () => {
  it("allows undeclared models when strict is off", async () => {
    const ctx = await harness("strict: false\n", { mock: mockProvider().provider });
    expect(ctx.ai.language("mock:chat").modelId).toBe("chat");
    expect(ctx.ai.metadata("mock:chat")).toBeUndefined();
  });

  it("rejects undeclared models when strict is on", async () => {
    const ctx = await harness(
      `
strict: true
providers:
  mock:
    models:
      - id: chat
`,
      { mock: mockProvider().provider },
    );
    expect(ctx.ai.language("mock:chat").modelId).toBe("chat");
    expect(() => ctx.ai.language("mock:other")).toThrow(/not declared in .* and strict mode is on/);
  });
});

describe("AIService settings injection", () => {
  const YAML = `
providers:
  mock:
    options:
      headers:
        X-Org: athena
    defaults:
      maxOutputTokens: 4096
      temperature: 1
      providerOptions:
        mock: { style: provider }
    models:
      - id: chat
        defaults:
          temperature: 0.2
          providerOptions:
            mock: { effort: high }
      - id: other
`;

  it("layers per-model defaults over per-provider defaults", async () => {
    const { provider, chat } = mockProvider();
    const ctx = await harness(YAML, { mock: provider });

    await ctx.ai.language("mock:chat").doGenerate({ prompt: USER_PROMPT });

    const call = chat.doGenerateCalls[0];
    expect(call.temperature).toBe(0.2);
    expect(call.maxOutputTokens).toBe(4096);
    expect(call.headers).toEqual({ "X-Org": "athena" });
    expect(call.providerOptions).toEqual({ mock: { style: "provider", effort: "high" } });
  });

  it("lets runtime call parameters win over declared defaults", async () => {
    const { provider, chat } = mockProvider();
    const ctx = await harness(YAML, { mock: provider });

    await ctx.ai.language("mock:chat").doGenerate({ prompt: USER_PROMPT, temperature: 0.9, headers: { "X-Org": "override" } });

    const call = chat.doGenerateCalls[0];
    expect(call.temperature).toBe(0.9);
    expect(call.headers).toEqual({ "X-Org": "override" });
  });

  it("applies provider-level settings to models with no defaults of their own", async () => {
    const { provider } = mockProvider();
    const ctx = await harness(YAML, { mock: provider });
    const other = ctx.ai.language("mock:other");

    await other.doGenerate({ prompt: USER_PROMPT });

    const call = (provider.languageModel("other") as MockLanguageModelV4).doGenerateCalls[0];
    expect(call.temperature).toBe(1);
    expect(call.maxOutputTokens).toBe(4096);
  });

  it("returns the bare model when nothing is declared", async () => {
    const { provider, chat } = mockProvider();
    const ctx = await harness("", { mock: provider });
    expect(ctx.ai.language("mock:chat")).toBe(chat);
  });

  it("injects headers into embedding calls", async () => {
    const { provider, embed } = mockProvider();
    const ctx = await harness(YAML, { mock: provider });

    await ctx.ai.embedding("mock:embed").doEmbed({ values: ["hi"] });

    expect(embed.doEmbedCalls[0].headers).toEqual({ "X-Org": "athena" });
  });
});
