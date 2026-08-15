import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentRegistry } from "../src/agent/index.js";
import type { Agent, AgentFactory } from "../src/agent/types.js";
import { sessionStore } from "../src/session/index.js";

describe("agent session cardinality", () => {
  it("allows one agent to hold multiple sessions", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry)];
    await Promise.all(fibers);

    const factory: AgentFactory = {
      create: async () => {
        const primary = ctx.sessions.create({ id: "primary" });
        const secondary = ctx.sessions.create({ id: "secondary" });
        const agent: Agent = {
          id: "multi",
          primarySession: primary,
          sessions: [primary, secondary],
          getSession: (id) => [primary, secondary].find((session) => session.id === id),
          model: {} as LanguageModel,
          maxSteps: 1,
          status: "idle",
          send() {},
          cancel() {},
          whenIdle: () => Promise.resolve(),
        };
        return {
          agent,
          dispose: async () => {
            ctx.sessions.remove("primary");
            ctx.sessions.remove("secondary");
          },
        };
      },
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    ctx.agents.setFactory(factory);

    const handle = await ctx.agents.create({
      model: {} as LanguageModel,
      maxSteps: 1,
    });
    expect(handle.agent.sessions).toHaveLength(2);
    expect(handle.agent.getSession("secondary")).toBeDefined();
    await ctx.agents.dispose(handle.agent.id);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
