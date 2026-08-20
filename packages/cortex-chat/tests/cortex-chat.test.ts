import MessageService from "@athena-ai/capability-message";
import { Life } from "@athena-ai/core";
import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import CortexChat from "../src/index.js";

describe("CortexChat", () => {
  it("activates when both life and message are available", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(MessageService, {});
    await ctx.plugin(CortexChat);
    expect(ctx.cortex).toBeInstanceOf(CortexChat);
  });

  it("does not activate without message service", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    // Don't await — fiber stays PENDING because 'message' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("does not activate without life service", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    // Don't await — fiber stays PENDING because 'life' inject is unmet
    ctx.plugin(CortexChat);
    expect(ctx.get("cortex")).toBeUndefined();
  });

  it("registers as the active cortex in Life", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, {
      persona: { name: "Alice", description: "Test", traits: {} },
    });
    await ctx.plugin(MessageService, {});
    await ctx.plugin(CortexChat);
    expect(Reflect.get(ctx.life, "_cortex")).toBeInstanceOf(CortexChat);
  });
});
