import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { memoryRegistry } from "../src/memory/index.js";
import { jsonlMemory, JsonlMemory } from "../src/memory/jsonl.js";

describe("memory infrastructure", () => {
  it("remembers and recalls life-scoped records", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(memoryRegistry);
    await fiber;

    await ctx.memory.remember({
      lifeId: "life-1",
      scope: "preference",
      category: "food",
      content: "likes tea",
      importance: 0.9,
    });
    const records = await ctx.memory.recall("life-1", { scope: "preference", query: "tea" });
    expect(records).toHaveLength(1);
    expect(records[0]!.content).toBe("likes tea");

    await fiber.dispose();
  });

  it("forgets and clears memory records", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(memoryRegistry);
    await fiber;

    const record = await ctx.memory.remember({
      lifeId: "life-2",
      scope: "biography",
      category: "fact",
      content: "lives in Shanghai",
    });
    expect(await ctx.memory.forget(record.id)).toBe(true);
    expect(await ctx.memory.recall("life-2")).toHaveLength(0);

    await ctx.memory.remember({
      lifeId: "life-3",
      scope: "relationship",
      category: "friend",
      content: "trusted",
    });
    await ctx.memory.clear("life-3");
    expect(await ctx.memory.recall("life-3")).toHaveLength(0);

    await fiber.dispose();
  });

  it("supports the early JsonlMemory provider", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-memory-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlMemory, { root });
    await fiber;

    await ctx.memory.remember({
      lifeId: "persistent-life",
      scope: "derived",
      category: "summary",
      content: "short summary",
    });
    const records = await ctx.memory.recall("persistent-life");
    expect(records).toHaveLength(1);
    expect(ctx.memory).toBeInstanceOf(JsonlMemory);

    await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
});
