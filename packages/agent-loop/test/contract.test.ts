import { AgentRegistry, type AgentFactory, type AgentHandle } from "@athena/agent";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import { fromPartial } from "@total-typescript/shoehorn";
import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../src/index.js";

describe("AgentLoop factory contract", () => {
  it("AgentLoop plugin registers a factory with ctx.agents", async () => {
    const ctx = new Context();
    await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(AgentRegistry), ctx.plugin(ToolRegistry), ctx.plugin(SystemPrompt)]);
    // Before AgentLoop plugin: no factory — create should throw
    await expect(ctx.agents.create({ model: fromPartial<LanguageModel>({}) })).rejects.toThrow(/No AgentFactory/);

    await ctx.plugin(AgentLoop);
    // After: create succeeds
    const handle = await ctx.agents.create({ model: fromPartial<LanguageModel>({}) });
    expect(handle.agent).toBeDefined();
    await handle.dispose();
  });

  it("custom factory registered after AgentLoop replaces it", async () => {
    const ctx = new Context();
    await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(AgentRegistry), ctx.plugin(ToolRegistry), ctx.plugin(SystemPrompt), ctx.plugin(AgentLoop)]);
    // AgentLoop already registered — second setFactory should throw
    const customFactory: AgentFactory = {
      createAgent: vi.fn(async () => fromPartial<AgentHandle>({ agent: fromPartial({}), dispose: async () => {} })),
      resumeAgent: vi.fn(async () => {
        throw new Error();
      }),
    };
    expect(() => ctx.agents.setFactory(customFactory)).toThrow(/already registered/);
  });
});
