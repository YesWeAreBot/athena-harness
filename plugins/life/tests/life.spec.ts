import { Context, Service } from "cordis";
import { describe, it, expect } from "vitest";

import { Life } from "../src/life";

class FakeCortex extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }
}

describe("Life", () => {
  it("provides ctx.life when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    expect(ctx.life).toBeInstanceOf(Life);
    expect(ctx.life.id).toBe("alice");
  });

  it("bind stores cortex reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    const mockCortex = new FakeCortex(ctx, "test-cortex");
    ctx.life.bind(mockCortex);
    expect(ctx.life.cortex).toBeInstanceOf(FakeCortex);
  });

  it("bind throws on second cortex", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    const cortex1 = new FakeCortex(ctx, "cortex-1");
    const cortex2 = new FakeCortex(ctx, "cortex-2");
    ctx.life.bind(cortex1);
    expect(() => ctx.life.bind(cortex2)).toThrow("Only one Cortex per Life");
  });

  it("bind returns disposer that clears reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    const cortex = new FakeCortex(ctx, "test-cortex");
    const unbind = ctx.life.bind(cortex);
    unbind();
    expect(ctx.life.cortex).toBeNull();
  });

  it("disposer ignores if already rebound", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      id: "alice",
    });
    const cortex1 = new FakeCortex(ctx, "cortex-1");
    const cortex2 = new FakeCortex(ctx, "cortex-2");
    const unbind1 = ctx.life.bind(cortex1);
    // Manually clear and rebind (simulating hot-reload)
    unbind1();
    ctx.life.bind(cortex2);
    // Old disposer should not clear new binding
    unbind1();
    expect(ctx.life.cortex).toBeInstanceOf(FakeCortex);
  });
});
