import { SessionRegistry } from "@athena/session";
import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";

import { AgentRegistry } from "../src/registry.js";
import type { Agent, AgentFactory, AgentHandle } from "../src/types.js";

function stubAgent(id: string): Agent {
  return {
    id,
    session: {} as never,
    model: {} as LanguageModel,
    maxSteps: 1,
    status: "idle",
    agentKey: Symbol(id),
    followup: () => {},
    steer: () => {},
    inject: () => {},
    cancel: () => {},
    whenIdle: () => Promise.resolve(),
  };
}

function stubHandle(id: string): AgentHandle {
  const agent = stubAgent(id);
  return { agent, dispose: async () => {} };
}

describe("AgentRegistry factory seam", () => {
  it("setFactory registers the factory; create delegates to it", async () => {
    const ctx = new Context();
    await ctx.plugin(SessionRegistry);
    await ctx.plugin(AgentRegistry);

    const createAgent = vi.fn(async () => stubHandle("a1"));
    const factory: AgentFactory = {
      createAgent,
      resumeAgent: async () => {
        throw new Error("not used");
      },
    };
    ctx.agents.setFactory(factory);

    const handle = await ctx.agents.create({ model: {} as LanguageModel });
    expect(createAgent).toHaveBeenCalledOnce();
    expect(handle.agent.id).toBe("a1");
  });

  it("get(id) returns the agent after create", async () => {
    const ctx = new Context();
    await ctx.plugin(AgentRegistry);
    ctx.agents.setFactory({
      createAgent: async () => stubHandle("b1"),
      resumeAgent: async () => {
        throw new Error();
      },
    });
    const handle = await ctx.agents.create({ model: {} as LanguageModel });
    expect(ctx.agents.get("b1")).toBe(handle.agent);
  });

  it("list() returns all live agents", async () => {
    const ctx = new Context();
    await ctx.plugin(AgentRegistry);
    ctx.agents.setFactory({
      createAgent: async (opts) => stubHandle(opts.id ?? "c1"),
      resumeAgent: async () => {
        throw new Error();
      },
    });
    await ctx.agents.create({ id: "c1", model: {} as LanguageModel });
    await ctx.agents.create({ id: "c2", model: {} as LanguageModel });
    const ids = ctx.agents.list().map((a) => a.id);
    expect(ids).toContain("c1");
    expect(ids).toContain("c2");
  });

  it("dispose() removes agent from list()", async () => {
    const ctx = new Context();
    await ctx.plugin(AgentRegistry);
    ctx.agents.setFactory({
      createAgent: async () => stubHandle("d1"),
      resumeAgent: async () => {
        throw new Error();
      },
    });
    const handle = await ctx.agents.create({ model: {} as LanguageModel });
    await handle.dispose();
    expect(ctx.agents.get("d1")).toBeUndefined();
    expect(ctx.agents.list().map((a) => a.id)).not.toContain("d1");
  });

  it("setFactory twice throws", async () => {
    const ctx = new Context();
    await ctx.plugin(AgentRegistry);
    const f: AgentFactory = {
      createAgent: async () => stubHandle("x"),
      resumeAgent: async () => {
        throw new Error();
      },
    };
    ctx.agents.setFactory(f);
    expect(() => ctx.agents.setFactory(f)).toThrow(/already registered/);
  });
});
