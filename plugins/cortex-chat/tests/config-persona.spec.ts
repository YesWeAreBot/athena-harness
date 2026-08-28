import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { ToolRegistry } from "@athena-ai/core";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context, Service } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import Life from "../../life/src/index.js";
import CortexChat from "../src/index.js";

describe("Life persona", () => {
  let tmpRoot: string | null = null;

  afterEach(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  it("defaults to DEFAULT_PERSONA", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { id: "alice" });
    expect(ctx.life.persona).toContain("Athena");
  });

  it("overrides with provided text", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { id: "bob", persona: "you are bob" });
    expect(ctx.life.persona).toBe("you are bob");
  });

  it("resolves a configured data directory under the Life id", async () => {
    const ctx = new Context();
    await ctx.plugin(Life, { id: "alice", dataDir: "/tmp/athena-test" });
    expect(ctx.life.dataDir).toBe(path.resolve("/tmp/athena-test", encodeURIComponent("alice")));
  });

  it("keeps different Life data directories separate", async () => {
    const ctx = new Context();
    const root = await mkdtemp(path.join(tmpdir(), "athena-life-"));
    tmpRoot = root;
    const alice = ctx.isolate("life", Symbol("alice")).isolate("nerve", Symbol("alice"));
    const bob = ctx.isolate("life", Symbol("bob")).isolate("nerve", Symbol("bob"));
    await alice.plugin(Life, { id: "alice", dataDir: root });
    await bob.plugin(Life, { id: "bob", dataDir: root });
    expect(alice.life.dataDir).not.toBe(bob.life.dataDir);
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
    await ctx.plugin(CortexChat, { model: "openai:gpt-4o", maxSteps: 10 });
    expect(ctx.get("cortex")).toBeDefined();
  });
});
