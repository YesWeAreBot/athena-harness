import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import { CortexService } from "../src/cortex.ts";
import { LifeService } from "../src/life.ts";

class TestCortex extends CortexService {
  constructor(ctx: Context) {
    super(ctx, "test-cortex");
  }
}

describe("Cortex", () => {
  it("binds with Life on init", async () => {
    const ctx = new Context();
    await ctx.plugin(LifeService, {
      id: "alice",
    });
    await ctx.plugin(TestCortex);
    expect(ctx.life.cortex).toBeInstanceOf(TestCortex);
  });

  it("unbinds on dispose", async () => {
    const ctx = new Context();
    await ctx.plugin(LifeService, {
      id: "alice",
    });
    const fork = await ctx.plugin(TestCortex);
    expect(ctx.life.cortex).toBeInstanceOf(TestCortex);
    await fork.dispose();
    expect(ctx.life.cortex === null).toBe(true);
  });

  it("second Cortex throws", async () => {
    const ctx = new Context();
    await ctx.plugin(LifeService, {
      id: "alice",
    });
    await ctx.plugin(TestCortex);

    class SecondCortex extends CortexService {
      constructor(ctx: Context) {
        super(ctx, "second-cortex");
      }
    }
    const fork = ctx.plugin(SecondCortex);
    await expect(fork).rejects.toThrow("Only one Cortex per Life");
  });

  it("does not activate without Life", () => {
    const ctx = new Context();
    ctx.plugin(TestCortex);
    expect(ctx.get("test-cortex")).toBeUndefined();
  });
});
