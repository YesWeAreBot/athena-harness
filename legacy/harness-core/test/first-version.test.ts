import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { jsonlPersistence } from "../src/persist/jsonl.js";
import { sessionStore } from "../src/session/index.js";
import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

function createMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "text-delta", id: "1", delta: "hello" });
          controller.enqueue({ type: "text-end", id: "1" });
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: "stop", raw: "stop" },
          });
          controller.close();
        },
      }),
    }),
  });
}

describe("first version acceptance", () => {
  it("runs one deterministic executable scenario", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      ctx.systemPrompt.registerSection("identity", "you are a digital life");

      const first = await ctx.agents.create({
        id: "first",
        model: createMockModel(),
        maxSteps: 3,
      });
      const second = await ctx.agents.create({
        id: "second",
        model: createMockModel(),
        maxSteps: 3,
      });

      first.agent.send("user/message", { content: "hello" });
      await first.agent.whenIdle();
      expect(first.agent.primarySession.snapshotEvents.some((event) => event.type === "assistant/message")).toBe(true);
      expect(second.agent.primarySession.snapshotEvents).toHaveLength(0);

      const original = first.agent.primarySession.snapshot();
      await ctx.agents.dispose(first.agent.id);
      expect(ctx.agents.get(second.agent.id)).toBe(second.agent);

      const resumed = await ctx.agents.resume({
        id: "first",
        model: createMockModel(),
        maxSteps: 3,
      });
      expect(resumed.agent.primarySession.snapshotEvents).toEqual(original.events);

      await ctx.agents.dispose(resumed.agent.id);
      await ctx.agents.dispose(second.agent.id);
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
