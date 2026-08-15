import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentRegistry } from "../src/agent/index.js";
import type { Agent, AgentFactory } from "../src/agent/types.js";
import { sessionStore } from "../src/session/index.js";

describe("teardown", () => {
  it("drains every registered agent exactly once", async () => {
    const ctx = new Context();
    const sessionFiber = ctx.plugin(sessionStore);
    const registryFiber = ctx.plugin(agentRegistry);
    const fibers = [sessionFiber, registryFiber];
    await Promise.all(fibers);

    let disposeCount = 0;
    const factory: AgentFactory = {
      create: async () =>
        createFakeHandle(ctx, "teardown", () => {
          disposeCount++;
        }),
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    ctx.agents.setFactory(factory);
    await ctx.agents.create({
      model: {} as LanguageModel,
      maxSteps: 1,
    });

    await registryFiber.dispose();
    expect(disposeCount).toBe(1);
    expect(ctx.sessions.get("teardown")).toBeUndefined();

    await sessionFiber.dispose();
  });
});

function createFakeHandle(ctx: Context, id: string, onDispose: () => void) {
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
      onDispose();
      ctx.sessions.remove(id);
    },
  };
}
