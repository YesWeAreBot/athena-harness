import { tool } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { ToolRegistry } from "../src/index.js";

function makeTool(name: string) {
  return tool({
    description: name,
    inputSchema: z.object({ x: z.string() }),
    execute: async ({ x }) => `result:${x}`,
  });
}

describe("ToolRegistry", () => {
  it("global tool visible in descriptors and executors", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("hello", makeTool("hello"));
    expect(ctx.tools.names()).toContain("hello");
    expect(ctx.tools.descriptors()["hello"]).toBeDefined();
    expect(ctx.tools.executors()["hello"]).toBeDefined();
  });

  it("descriptors never has execute", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("t", makeTool("t"));
    const desc = ctx.tools.descriptors();
    expect((desc["t"] as Record<string, unknown>)["execute"]).toBeUndefined();
  });

  it("executors preserves execute", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("t", makeTool("t"));
    const exec = ctx.tools.executors();
    expect(typeof (exec["t"] as Record<string, unknown>)["execute"]).toBe("function");
  });

  it("scoped tool only visible when correct key passed", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const key = Symbol("agent1");
    ctx.tools.register("scoped", makeTool("scoped"), key);
    expect(ctx.tools.names()).not.toContain("scoped");
    expect(ctx.tools.names(key)).toContain("scoped");
  });

  it("activeTools filters out unlisted tools", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("a", makeTool("a"));
    ctx.tools.register("b", makeTool("b"));
    const desc = ctx.tools.descriptors(undefined, new Set(["a"]));
    expect(desc["a"]).toBeDefined();
    expect(desc["b"]).toBeUndefined();
  });

  it("duplicate global registration throws", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("dup", makeTool("dup"));
    expect(() => ctx.tools.register("dup", makeTool("dup"))).toThrow(/already registered/);
  });

  it("cleanup function removes the registration", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(ToolRegistry);
    await fiber;
    const cleanup = ctx.tools.register("temp", makeTool("temp"));
    expect(ctx.tools.names()).toContain("temp");
    cleanup();
    expect(ctx.tools.names()).not.toContain("temp");
    await fiber.dispose();
  });
});
