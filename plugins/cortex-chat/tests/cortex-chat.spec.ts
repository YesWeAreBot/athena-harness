import { NerveService } from "@athena-ai/protocol";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context, Service } from "cordis";
import { describe, it, expect } from "vitest";

import Life from "../../life/src/index.js";
import CortexChat from "../src/index.js";

/** Minimal AIService stub — just enough to satisfy the inject requirement. */
class FakeAI extends Service {
  constructor(ctx: Context) {
    super(ctx, "ai");
  }

  language() {
    return {};
  }
}

/** Set up a Context with all required dependencies for CortexChat. */
async function setup(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(Database);
  await ctx.plugin(MemoryDriver);
  await ctx.plugin(FakeAI);
  return ctx;
}

describe("CortexChat", () => {
  it("activates when both life and nerve are available", async () => {
    const ctx = await setup();
    await ctx.plugin(Life, { id: "alice" });
    await ctx.plugin(NerveService);
    await ctx.plugin(CortexChat);
    expect(ctx.cortex).toBeInstanceOf(CortexChat);
  });

  it("does not activate without life service", async () => {
    const ctx = await setup();
    await ctx.plugin(NerveService);
    // Don't await — fiber stays PENDING because 'life' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("does not activate without nerve service", async () => {
    const ctx = await setup();
    await ctx.plugin(Life, { id: "alice" });
    // Don't await — fiber stays PENDING because 'nerve' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("binds as the active cortex in Life", async () => {
    const ctx = await setup();
    await ctx.plugin(Life, { id: "alice" });
    await ctx.plugin(NerveService);
    await ctx.plugin(CortexChat);
    expect(ctx.life.cortex).toBeInstanceOf(CortexChat);
  });
});
