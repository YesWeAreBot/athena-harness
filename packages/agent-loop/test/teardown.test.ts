import { agentRegistry } from "@athena/agent";
import { systemPrompt } from "@athena/prompt";
import { sessionRegistry } from "@athena/session";
import { toolRegistry } from "@athena/tools";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/index.js";

async function setup() {
  const ctx = new Context();
  await Promise.all([ctx.plugin(sessionRegistry), ctx.plugin(agentRegistry), ctx.plugin(toolRegistry), ctx.plugin(systemPrompt), ctx.plugin(agentLoop)]);
  return ctx;
}

describe("teardown — no resource leaks", () => {
  it("dispose() resolves whenIdle() and sets status to disposed", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({
      model: new MockLanguageModelV4({
        doStream: async () => ({
          stream: new ReadableStream({
            start(c) {
              c.enqueue({ type: "text-start", id: "1" });
              c.enqueue({ type: "text-delta", id: "1", delta: "hi" });
              c.enqueue({ type: "text-end", id: "1" });
              c.enqueue({
                type: "finish",
                usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                finishReason: { unified: "stop", raw: "stop" },
              });
              c.close();
            },
          }),
        }),
      }),
    });
    handle.agent.followup("hi");
    await handle.dispose();
    expect(handle.agent.status).toBe("disposed");
    // whenIdle() on a disposed agent resolves immediately
    await expect(handle.agent.whenIdle()).resolves.toBeUndefined();
  });

  it("followup after dispose throws", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({ model: new MockLanguageModelV4() });
    await handle.dispose();
    expect(() => handle.agent.followup("late")).toThrow(/disposed/);
  });

  it("steer after dispose throws", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({ model: new MockLanguageModelV4() });
    await handle.dispose();
    expect(() => handle.agent.steer("late")).toThrow(/disposed/);
  });

  it("inject after dispose throws", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({ model: new MockLanguageModelV4() });
    await handle.dispose();
    expect(() => handle.agent.inject("late")).toThrow(/disposed/);
  });
});
