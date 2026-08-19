import { Context, Service } from "cordis";
import { describe, it, expect } from "vitest";

import { Life } from "../src/life";

// Helper to access internal _cortex field for testing
function getCortex(life: Life): Service | null {
  // eslint-disable-next-line -- test-only access to private field
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

  it("registerCortex stores reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const mockCortex = { name: "test-cortex" } as unknown as Service;
    ctx.life.registerCortex(mockCortex);
    expect(getCortex(ctx.life)).toBe(mockCortex);
  });

  it("throws on second registerCortex", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex1 = { name: "cortex-1" } as unknown as Service;
    const cortex2 = { name: "cortex-2" } as unknown as Service;
    ctx.life.registerCortex(cortex1);
    expect(() => ctx.life.registerCortex(cortex2)).toThrow("Only one Cortex per Life");
  });

  it("unregisterCortex clears reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex = { name: "test-cortex" } as unknown as Service;
    ctx.life.registerCortex(cortex);
    ctx.life.unregisterCortex(cortex);
    expect(getCortex(ctx.life)).toBeNull();
  });

  it("unregisterCortex ignores wrong reference", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    const cortex1 = { name: "cortex-1" } as unknown as Service;
    const cortex2 = { name: "cortex-2" } as unknown as Service;
    ctx.life.registerCortex(cortex1);
    ctx.life.unregisterCortex(cortex2); // wrong ref, should not clear
    expect(getCortex(ctx.life)).toBe(cortex1);
  });
});
