import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { systemPrompt } from "../src/index.js";
import type { PromptSection } from "../src/index.js";

function section(name: string, content: string, order?: number): PromptSection {
  return { name, order, render: () => content };
}

describe("SystemPrompt", () => {
  it("assembles sections in order weight (ascending)", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    ctx.systemPrompt.add(section("b", "B", 2));
    ctx.systemPrompt.add(section("a", "A", 1));
    const result = await ctx.systemPrompt.assemble();
    expect(result.sections.map((s) => s.name)).toEqual(["a", "b"]);
    expect(result.system).toBe("A\n\nB");
  });

  it("default order 0 — sections with same order maintain insertion order (stable sort)", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    ctx.systemPrompt.add(section("x", "X"));
    ctx.systemPrompt.add(section("y", "Y"));
    const result = await ctx.systemPrompt.assemble();
    const names = result.sections.map((s) => s.name);
    expect(names.indexOf("x")).toBeLessThan(names.indexOf("y"));
  });

  it("scoped section overrides global of same name", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    const key = Symbol("agent");
    ctx.systemPrompt.add(section("greeting", "global"));
    ctx.systemPrompt.add(section("greeting", "scoped"), key);
    const result = await ctx.systemPrompt.assemble(key);
    expect(result.sections.find((s) => s.name === "greeting")?.content).toBe("scoped");
  });

  it("rendered fingerprint is stable when content unchanged", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    ctx.systemPrompt.add(section("s", "hello world"));
    const r1 = await ctx.systemPrompt.assemble();
    const r2 = await ctx.systemPrompt.assemble();
    expect(r1.rendered).toBe(r2.rendered);
  });

  it("rendered fingerprint changes when content changes", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    let value = "v1";
    ctx.systemPrompt.add({ name: "dynamic", render: () => value });
    const r1 = await ctx.systemPrompt.assemble();
    value = "v2";
    const r2 = await ctx.systemPrompt.assemble();
    expect(r1.rendered).not.toBe(r2.rendered);
  });

  it("duplicate global section registration throws", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    ctx.systemPrompt.add(section("dup", "x"));
    expect(() => ctx.systemPrompt.add(section("dup", "y"))).toThrow(/already registered/);
  });

  it("AbortSignal is forwarded to async render", async () => {
    const ctx = new Context();
    await ctx.plugin(systemPrompt);
    let received: AbortSignal | undefined;
    ctx.systemPrompt.add({
      name: "spy",
      render: (sig) => { received = sig; return "ok"; },
    });
    const ctrl = new AbortController();
    await ctx.systemPrompt.assemble(undefined, ctrl.signal);
    expect(received).toBe(ctrl.signal);
  });
});
