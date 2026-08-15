import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentRegistry } from "../src/agent/index.js";
import type { Agent, AgentFactory } from "../src/agent/types.js";
import { Session, sessionStore } from "../src/session/index.js";

describe("concurrent create", () => {
  it("allows one owner and rolls back the loser", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry)];
    await Promise.all(fibers);

    const factory: AgentFactory = {
      create: async (input) => {
        const session = ctx.sessions.create({ id: input.id ?? "same" });
        return createFakeHandle(ctx, session);
      },
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    ctx.agents.setFactory(factory);

    const results = await Promise.allSettled([
      ctx.agents.create({ id: "same", model: {} as LanguageModel, maxSteps: 1 }),
      ctx.agents.create({ id: "same", model: {} as LanguageModel, maxSteps: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(ctx.agents.get("same")).toBeDefined();
    expect(ctx.sessions.get("same")).toBeDefined();

    await ctx.agents.dispose("same");
    expect(ctx.sessions.get("same")).toBeUndefined();
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("disposes a factory handle when registration loses a race", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry)];
    await Promise.all(fibers);

    let disposeCount = 0;
    const factory: AgentFactory = {
      create: async () =>
        createFakeHandleWithoutStore("race", () => {
          disposeCount++;
        }),
      resume: async () => {
        throw new Error("not implemented");
      },
    };
    ctx.agents.setFactory(factory);

    const results = await Promise.allSettled([
      ctx.agents.create({ id: "race", model: {} as LanguageModel, maxSteps: 1 }),
      ctx.agents.create({ id: "race", model: {} as LanguageModel, maxSteps: 1 }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(disposeCount).toBe(1);

    await ctx.agents.dispose("race");
    expect(disposeCount).toBe(2);
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});

function createFakeHandle(ctx: Context, session: ReturnType<Context["sessions"]["create"]>) {
  const agent: Agent = {
    id: session.id,
    primarySession: session,
    sessions: [session],
    getSession: (id) => (id === session.id ? session : undefined),
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
      ctx.sessions.remove(session.id);
    },
  };
}

function createFakeHandleWithoutStore(id: string, onDispose: () => void) {
  const session = new Session({ id });
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
    },
  };
}
