import { MockLanguageModelV4, MockProviderV4 } from "ai/test";
import { Context } from "cordis";
import { afterAll, describe, expect, it } from "vitest";

import { AIService, CircuitBreaker } from "../src/index.ts";
import { cleanupModelsConfigs, writeModelsConfig } from "./helpers.ts";

afterAll(cleanupModelsConfigs);

const GENERATE_RESULT = {
  content: [{ type: "text" as const, text: "ok" }],
  finishReason: "stop" as const,
  usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  warnings: [],
};

function providerWith(...modelIds: string[]) {
  const languageModels: Record<string, MockLanguageModelV4> = {};
  for (const modelId of modelIds) languageModels[modelId] = new MockLanguageModelV4({ modelId, doGenerate: GENERATE_RESULT });
  return new MockProviderV4({ languageModels });
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

async function harness(yaml: string) {
  const ctx = new Context();
  await ctx.plugin(AIService, { configPath: writeModelsConfig(yaml) });
  ctx.ai.register("mock", providerWith("a", "b", "c"));
  return ctx;
}

const YAML = `
aliases:
  fast: mock:b
providers:
  mock:
    models:
      - id: a
        metadata: { toolCall: true }
      - id: b
      - id: c
groups:
  main:
    strategy: failover
    models: [mock:a, fast, mock:c]
    circuitBreaker:
      failureThreshold: 2
      recoveryTimeout: 0.05
  rotating:
    strategy: round-robin
    models: [mock:a, mock:b, mock:c]
  lucky:
    strategy: random
    models: [mock:a, mock:b, mock:c]
  broken:
    models: [ghost:a, mock:b]
`;

describe("CircuitBreaker", () => {
  it("opens after the threshold and recovers into half-open", async () => {
    const breaker = new CircuitBreaker({ failureThreshold: 2, recoveryTimeout: 0.05 });
    expect(breaker.state).toBe("closed");

    breaker.failure();
    expect(breaker.status).toEqual({ state: "closed", failures: 1 });

    breaker.failure();
    expect(breaker.state).toBe("open");
    expect(breaker.available).toBe(false);

    await delay(70);
    expect(breaker.state).toBe("half-open");
    expect(breaker.available).toBe(true);

    breaker.failure();
    expect(breaker.state).toBe("open");

    breaker.success();
    expect(breaker.status).toEqual({ state: "closed", failures: 0 });
  });
});

describe("AIService.candidates", () => {
  it("returns one candidate for a fully qualified id", async () => {
    const ctx = await harness(YAML);
    const candidates = ctx.ai.candidates("mock:a");
    expect(candidates).toHaveLength(1);
    expect(candidates[0].id).toBe("mock:a");
    expect(candidates[0].metadata).toEqual({ toolCall: true });
    expect(() => candidates[0].failure()).not.toThrow();
  });

  it("returns one candidate for an alias", async () => {
    const ctx = await harness(YAML);
    const candidates = ctx.ai.candidates("fast");
    expect(candidates.map((candidate) => candidate.id)).toEqual(["mock:b"]);
  });

  it("prefers a group over an alias and normalises members", async () => {
    const ctx = await harness(YAML);
    expect(ctx.ai.candidates("main").map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
  });

  it("hands back an empty-metadata candidate for undeclared models", async () => {
    const ctx = await harness(YAML);
    ctx.ai.register("extra", providerWith("z"));
    expect(ctx.ai.candidates("extra:z")[0].metadata).toEqual({});
  });

  it("rejects an empty input", async () => {
    const ctx = await harness(YAML);
    expect(() => ctx.ai.candidates("")).toThrow(/needs a model id/);
  });
});

describe("ModelGroup", () => {
  it("skips models whose breaker is open, then restores them after recovery", async () => {
    const ctx = await harness(YAML);
    const group = ctx.ai.group("main");

    const [first] = group.candidates();
    first.failure();
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);

    group.candidates()[0].failure();
    expect(group.status().get("mock:a")).toEqual({ state: "open", failures: 2 });
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:b", "mock:c"]);

    await delay(70);
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
  });

  it("closes a breaker on success and on an explicit reset", async () => {
    const ctx = await harness(YAML);
    const group = ctx.ai.group("main");

    group.candidates()[0].failure();
    group.candidates()[0].success();
    expect(group.status().get("mock:a")).toEqual({ state: "closed", failures: 0 });

    group.candidates()[0].failure();
    group.candidates()[0].failure();
    expect(group.status().get("mock:a")?.state).toBe("open");
    group.reset("mock:a");
    expect(group.status().get("mock:a")).toEqual({ state: "closed", failures: 0 });
  });

  it("rejects a reset for a model outside the group", async () => {
    const ctx = await harness(YAML);
    expect(() => ctx.ai.group("main").reset("mock:zzz")).toThrow(/is not a member of group "main"/);
  });

  it("offers every model again once all breakers are open", async () => {
    const ctx = await harness(YAML);
    const group = ctx.ai.group("main");
    for (const candidate of group.candidates()) {
      candidate.failure();
      candidate.failure();
    }
    expect([...group.status().values()].every((status) => status.state === "open")).toBe(true);
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
  });

  it("rotates the head on each call under round-robin", async () => {
    const ctx = await harness(YAML);
    const group = ctx.ai.group("rotating");
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:b", "mock:c", "mock:a"]);
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:c", "mock:a", "mock:b"]);
    expect(group.candidates().map((candidate) => candidate.id)).toEqual(["mock:a", "mock:b", "mock:c"]);
  });

  it("returns every model in some order under random", async () => {
    const ctx = await harness(YAML);
    const group = ctx.ai.group("lucky");
    expect(group.strategy).toBe("random");
    for (let round = 0; round < 10; round++) {
      expect(
        group
          .candidates()
          .map((candidate) => candidate.id)
          .sort(),
      ).toEqual(["mock:a", "mock:b", "mock:c"]);
    }
  });

  it("drops members whose provider is missing instead of failing the group", async () => {
    const ctx = await harness(YAML);
    expect(
      ctx.ai
        .group("broken")
        .candidates()
        .map((candidate) => candidate.id),
    ).toEqual(["mock:b"]);
  });

  it("throws for an unknown group name", async () => {
    const ctx = await harness(YAML);
    expect(() => ctx.ai.group("nope")).toThrow(/Unknown model group "nope"/);
  });

  it("refuses to resolve a non-language modality through a group", async () => {
    const ctx = await harness(YAML);
    expect(() => ctx.ai.embedding("main")).toThrow(/groups hold language models/);
  });

  it("drops group members that cannot be normalised", async () => {
    const ctx = await harness(`
providers:
  mock:
    models:
      - id: a
groups:
  nested:
    models: [nested, mock:a]
`);
    expect(
      ctx.ai
        .group("nested")
        .candidates()
        .map((candidate) => candidate.id),
    ).toEqual(["mock:a"]);
  });
});
