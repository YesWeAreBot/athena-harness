import { Context, Service } from "cordis";
import { describe, it, expect } from "vitest";

import { Life } from "../src/life";

// Helper to access internal _cortex field for testing
function getCortex(life: Life): Service | null {
  return Reflect.get(life, "_cortex") as Service | null;
}

describe("Life", () => {
  it("provides ctx.life when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "A test persona", traits: {} },
    });
    expect(ctx.life).toBeInstanceOf(Life);
    expect(ctx.life.persona.name).toBe("Alice");
  });

  it("bind stores cortex reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const mockCortex = { name: "test-cortex" } as unknown as Service;
    ctx.life.bind(mockCortex);
    expect(getCortex(ctx.life)).toBe(mockCortex);
  });

  it("bind throws on second cortex", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex1 = { name: "cortex-1" } as unknown as Service;
    const cortex2 = { name: "cortex-2" } as unknown as Service;
    ctx.life.bind(cortex1);
    expect(() => ctx.life.bind(cortex2)).toThrow("Only one Cortex per Life");
  });

  it("bind returns disposer that clears reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex = { name: "test-cortex" } as unknown as Service;
    const unbind = ctx.life.bind(cortex);
    unbind();
    expect(getCortex(ctx.life)).toBeNull();
  });

  it("disposer ignores if already rebound", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex1 = { name: "cortex-1" } as unknown as Service;
    const cortex2 = { name: "cortex-2" } as unknown as Service;
    const unbind1 = ctx.life.bind(cortex1);
    // Manually clear and rebind (simulating hot-reload)
    unbind1();
    ctx.life.bind(cortex2);
    // Old disposer should not clear new binding
    unbind1();
    expect(getCortex(ctx.life)).toBe(cortex2);
  });
});
