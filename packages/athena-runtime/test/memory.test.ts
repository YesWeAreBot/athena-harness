import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { LifeMemory, memoryRegistry } from "../src/memory/index.js";
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

  it("allows third-party Memory providers to replace the default", async () => {
    const ctx = new Context();
    const calls: string[] = [];
    class CustomMemory extends LifeMemory {
      constructor(next: Context) {
        super(next);
      }

      override async remember(input: Parameters<LifeMemory["remember"]>[0]) {
        calls.push(`remember:${input.lifeId}`);
        return {
          id: "custom-1",
          lifeId: input.lifeId,
          scope: input.scope,
          category: input.category,
          content: input.content,
          importance: input.importance ?? 0.5,
          confidence: input.confidence ?? 0.5,
          createdAt: Date.now(),
        };
      }

      override async recall() {
        return [];
      }

      override async forget() {
        return true;
      }

      override async clear() {}
    }

    const fiber = ctx.plugin({
      apply(next) {
        next.memory = new CustomMemory(next) as never;
      },
    });
    await fiber;

    await ctx.memory.remember({
      lifeId: "life-custom",
      scope: "identity",
      category: "name",
      content: "Athena",
    });
    expect(calls).toEqual(["remember:life-custom"]);
    await fiber.dispose();
  });

  it("serializes concurrent JsonlMemory writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-memory-concurrent-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlMemory, { root });
    await fiber;

    await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        ctx.memory.remember({
          lifeId: "concurrent-life",
          scope: "derived",
          category: "note",
          content: `note-${index}`,
        }),
      ),
    );
    expect(await ctx.memory.recall("concurrent-life")).toHaveLength(40);

    await fiber.dispose();
    await rm(root, { recursive: true, force: true });
  });
});
