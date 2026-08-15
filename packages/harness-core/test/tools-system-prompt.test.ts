import type { Tool } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

describe("tool runtime", () => {
  it("registers, snapshots, and removes tools", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(toolRuntime);
    await fiber;

    const tool = {} as Tool;
    const dispose = ctx.tools.register("echo", tool);
    expect(ctx.tools.snapshot().echo).toBe(tool);

    dispose();
    expect(ctx.tools.snapshot().echo).toBeUndefined();

    await fiber.dispose();
  });

  it("allows scoped tools to shadow globals", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(toolRuntime);
    await fiber;

    const globalTool = {} as Tool;
    const scopedTool = {} as Tool;
    const scope = Symbol("agent");
    ctx.tools.register("echo", globalTool);
    ctx.tools.register("echo", scopedTool, scope);

    expect(ctx.tools.snapshot().echo).toBe(globalTool);
    expect(ctx.tools.snapshot(scope).echo).toBe(scopedTool);

    await fiber.dispose();
  });
});

describe("system prompt", () => {
  it("assembles static sections and dynamic context", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(systemPrompt);
    await fiber;

    ctx.systemPrompt.registerSection("identity", "you are a digital life");
    ctx.systemPrompt.registerSection("rules", "keep existing");
    ctx.systemPrompt.registerContextProvider("time", async () => "12:00");

    const snapshot = await ctx.systemPrompt.snapshot();
    expect(snapshot.system).toContain("you are a digital life");
    expect(snapshot.rendered).toContain("12:00");

    await fiber.dispose();
  });

  it("shadows global sections in an agent scope", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(systemPrompt);
    await fiber;

    const scope = Symbol("agent");
    ctx.systemPrompt.registerSection("identity", "global identity");
    ctx.systemPrompt.registerSection("identity", "agent identity", scope);

    const global = await ctx.systemPrompt.snapshot();
    const scoped = await ctx.systemPrompt.snapshot(scope);
    expect(global.system).toContain("global identity");
    expect(global.system).not.toContain("agent identity");
    expect(scoped.system).toContain("agent identity");

    await fiber.dispose();
  });
});
