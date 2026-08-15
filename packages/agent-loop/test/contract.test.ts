import { agentRegistry, type AgentFactory, type AgentHandle } from "@athena/agent";
import { systemPrompt } from "@athena/prompt";
import { sessionRegistry } from "@athena/session";
import { toolRegistry } from "@athena/tools";
import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";

import { agentLoop } from "../src/index.js";

describe("agentLoop factory contract", () => {
  it("agentLoop plugin registers a factory with ctx.agents", async () => {
    const ctx = new Context();
    await Promise.all([ctx.plugin(sessionRegistry), ctx.plugin(agentRegistry), ctx.plugin(toolRegistry), ctx.plugin(systemPrompt)]);
    // Before agentLoop plugin: no factory — create should throw
    await expect(ctx.agents.create({ model: {} as LanguageModel })).rejects.toThrow(/No AgentFactory/);

    await ctx.plugin(agentLoop);
    // After: create succeeds
    const handle = await ctx.agents.create({ model: {} as LanguageModel });
    expect(handle.agent).toBeDefined();
    await handle.dispose();
  });

  it("custom factory registered after agentLoop replaces it", async () => {
    const ctx = new Context();
    await Promise.all([ctx.plugin(sessionRegistry), ctx.plugin(agentRegistry), ctx.plugin(toolRegistry), ctx.plugin(systemPrompt), ctx.plugin(agentLoop)]);
    // agentLoop already registered — second setFactory should throw
    const customFactory: AgentFactory = {
      createAgent: vi.fn(async () => ({ agent: {} as never, dispose: async () => {} }) as AgentHandle),
      resumeAgent: vi.fn(async () => {
        throw new Error();
      }),
    };
    expect(() => ctx.agents.setFactory(customFactory)).toThrow(/already registered/);
  });
});
