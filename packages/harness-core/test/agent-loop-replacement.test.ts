import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentRegistry } from "../src/agent/index.js";
import type { Agent, AgentFactory } from "../src/agent/types.js";
import { sessionStore } from "../src/session/index.js";

describe("agent loop replacement", () => {
  it("replaces one Agent Factory without leaking sessions", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry)];
    await Promise.all(fibers);

    let firstCalls = 0;
    const firstFactory: AgentFactory = {
      create: async () => {
        firstCalls++;
        return createFakeHandle(ctx, "first");
      },
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    const disposeFirst = ctx.agents.setFactory(firstFactory);
    const first = await ctx.agents.create({
      model: {} as LanguageModel,
      maxSteps: 1,
    });
    expect(firstCalls).toBe(1);
    await ctx.agents.dispose(first.agent.id);
    disposeFirst();

    let secondCalls = 0;
    const secondFactory: AgentFactory = {
      create: async () => {
        secondCalls++;
        return createFakeHandle(ctx, "second");
      },
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    const disposeSecond = ctx.agents.setFactory(secondFactory);
    const second = await ctx.agents.create({
      model: {} as LanguageModel,
      maxSteps: 1,
    });
    expect(secondCalls).toBe(1);
    await ctx.agents.dispose(second.agent.id);
    disposeSecond();

    expect(ctx.sessions.get("first")).toBeUndefined();
    expect(ctx.sessions.get("second")).toBeUndefined();
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});

function createFakeHandle(ctx: Context, id: string) {
  const session = ctx.sessions.create({ id });
  const agent: Agent = {
    id,
    primarySession: session,
    sessions: [session],
    getSession: (sessionId) => (sessionId === id ? session : undefined),
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
      ctx.sessions.remove(id);
    },
  };
}
