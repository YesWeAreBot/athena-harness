import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { sessionStore } from "../src/session/index.js";
import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

function lengthModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "text-delta", id: "1", delta: "partial" });
          controller.enqueue({ type: "text-end", id: "1" });
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: "length", raw: "length" },
          });
          controller.close();
        },
      }),
    }),
  });
}

function toolCallModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "tool-input-start", id: "2", toolName: "echo" });
          controller.enqueue({ type: "tool-input-delta", id: "2", delta: '{"value":"x"}' });
          controller.enqueue({ type: "tool-input-end", id: "2" });
          controller.enqueue({
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "echo",
            input: '{"value":"x"}',
          });
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 0, reasoning: 0 },
            },
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
          });
          controller.close();
        },
      }),
    }),
  });
}

describe("agent loop end reasons", () => {
  it("ends with max-tokens when the model reports an output limit", async () => {
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    const handle = await ctx.agents.create({
      model: lengthModel(),
      maxSteps: 3,
    });
    handle.agent.send("user/message", { content: "hello" });
    await handle.agent.whenIdle();

    const end = handle.agent.primarySession.snapshotEvents.find((event) => event.type === "turn/end");
    expect(end?.data).toMatchObject({
      reason: { kind: "max-tokens" },
    });

    await ctx.agents.dispose(handle.agent.id);
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("ends with max-steps when the loop limit is reached", async () => {
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    const handle = await ctx.agents.create({
      model: toolCallModel(),
      maxSteps: 1,
    });
    handle.agent.send("user/message", { content: "hello" });
    await handle.agent.whenIdle();

    const end = handle.agent.primarySession.snapshotEvents.find((event) => event.type === "turn/end");
    expect(end?.data).toMatchObject({
      reason: { kind: "max-steps", limit: 1 },
    });

    await ctx.agents.dispose(handle.agent.id);
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
