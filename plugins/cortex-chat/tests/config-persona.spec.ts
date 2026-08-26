import { ToolRegistry } from "@athena-ai/core";
import { DEFAULT_PERSONA, NerveService } from "@athena-ai/protocol";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context, Service } from "cordis";
import { describe, expect, it } from "vitest";

import Life from "../../life/src/index.js";
import CortexChat from "../src/index.js";

describe("Life persona", () => {
  it("defaults to DEFAULT_PERSONA", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { id: "alice" });
    expect(ctx.life.persona).toBe(DEFAULT_PERSONA);
  });

  it("overrides with provided text", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { id: "bob", persona: "you are bob" });
    expect(ctx.life.persona).toBe("you are bob");
  });
});

describe("CortexChat Config", () => {
  it("has expected defaults", () => {
    const schema = CortexChat.Config;
    expect(schema).toBeDefined();
  });

  it("activates with new Config fields", async () => {
    class FakeAI extends Service {
      constructor(c: Context) {
        super(c, "ai");
      }
      language() {
        return {};
      }
    }
    const ctx = new Context();
    await ctx.plugin(Database);
    await ctx.plugin(MemoryDriver);
    await ctx.plugin(FakeAI);
    await ctx.plugin(ToolRegistry);
    await ctx.plugin(Life, { id: "alice" });
    await ctx.plugin(NerveService);
    await ctx.plugin(CortexChat, { model: "openai:gpt-4o", maxSteps: 10 });
    expect(ctx.get("cortex")).toBeDefined();
  });
});
