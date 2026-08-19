import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import { Cortex } from "../src/cortex";
import { Life } from "../src/life";

class TestCortex extends Cortex {
  constructor(ctx: Context) {
    super(ctx, "test-cortex");
  }
}

describe("Cortex", () => {
  it("registers with Life on init", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(TestCortex);
    expect(Reflect.get(ctx.life, "_cortex")).toBeInstanceOf(TestCortex);
  });

  it("unregisters on dispose", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const fork = await ctx.plugin(TestCortex);
    expect(Reflect.get(ctx.life, "_cortex")).toBeInstanceOf(TestCortex);
    await fork.dispose();
    // Use strict equality check to avoid vitest serializing the disposed context
    expect(Reflect.get(ctx.life, "_cortex") === null).toBe(true);
  });

  it("second Cortex throws", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(TestCortex);

    class SecondCortex extends Cortex {
      constructor(ctx: Context) {
        super(ctx, "second-cortex");
      }
    }
    // Second cortex should fail — Service.init throws during registerCortex
    const fork = ctx.plugin(SecondCortex);
    await expect(fork).rejects.toThrow("Only one Cortex per Life");
  });

  it("does not activate without Life", () => {
    const ctx = new Context();
    // Don't await — fiber stays PENDING because 'life' inject is unmet
    ctx.plugin(TestCortex);
    // Service never activates so it remains undefined
    expect(ctx.get("test-cortex")).toBeUndefined();
  });
});
