import { AgentRegistry, type AgentFactory, type AgentHandle } from "@athena/agent";
import { AgentLoop } from "@athena/agent-loop";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoopRegistry } from "../src/agent-loop/index.js";

describe("agent loop infrastructure", () => {
  it("registers providers and delegates create/resume", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(agentLoopRegistry);
    await fiber;

    const handle = { agent: {} as never, dispose: async () => {} } as AgentHandle;
    let created = 0;
    let resumed = 0;
    const disposeProvider = ctx.agentLoop.register({
      id: "mock",
      factory: {
        createAgent: async () => {
          created++;
          return handle;
        },
        resumeAgent: async () => {
          resumed++;
          return handle;
        },
      },
    });

    expect(ctx.agentLoop.get("mock")?.id).toBe("mock");
    await expect(ctx.agentLoop.create("mock", { model: {} as never, maxSteps: 1 })).resolves.toBe(handle);
    await expect(ctx.agentLoop.resume("mock", { id: "session-1", model: {} as never, maxSteps: 1 })).resolves.toBe(handle);
    expect(created).toBe(1);
    expect(resumed).toBe(1);
    await expect(ctx.agentLoop.create("missing", { model: {} as never, maxSteps: 1 })).rejects.toThrow(/not found/);

    await disposeProvider();
    expect(ctx.agentLoop.get("mock")).toBeUndefined();
    await fiber.dispose();
  });

  it("registers the canonical @athena/agent-loop as a provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(ToolRegistry),
      ctx.plugin(SystemPrompt),
      ctx.plugin(AgentRegistry),
      ctx.plugin(AgentLoop),
      ctx.plugin(agentLoopRegistry),
    ]);

    const factory: AgentFactory = {
      createAgent: (options) => ctx.agents.create(options),
      resumeAgent: (options) => ctx.agents.resume(options),
    };
    const disposeProvider = ctx.agentLoop.register({ id: "@athena/agent-loop", factory });

    const handle = await ctx.agentLoop.create("@athena/agent-loop", {
      model: new MockLanguageModelV4(),
      maxSteps: 1,
    });
    expect(handle.agent.session).toBeDefined();

    await handle.dispose();
    await disposeProvider();
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
