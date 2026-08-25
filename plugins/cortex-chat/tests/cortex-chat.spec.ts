import { NerveService } from "@athena-ai/protocol";
import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import { Life } from "../../life/src/life.js";
import CortexChat from "../src/index.js";

describe("CortexChat", () => {
  it("activates when both life and nerve are available", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    await ctx.plugin(NerveService);
    await ctx.plugin(CortexChat);
    expect(ctx.cortex).toBeInstanceOf(CortexChat);
  });

  it("does not activate without nerve service", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    // Don't await — fiber stays PENDING because 'nerve' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("does not activate without life service", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    // Don't await — fiber stays PENDING because 'life' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("binds as the active cortex in Life", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    await ctx.plugin(NerveService);
    await ctx.plugin(CortexChat);
    expect(ctx.life.cortex).toBeInstanceOf(CortexChat);
  });
});
