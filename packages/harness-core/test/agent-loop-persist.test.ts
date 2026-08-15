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

describe("agent loop persistence", () => {
  it("persists durable turn events through jsonl", async () => {
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
      const handle = await ctx.agents.create({
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      await ctx.agents.dispose(handle.agent.id);

      const prepared = await ctx.persist.prepare(handle.agent.id);
      const types = prepared.events.map((event) => event.type);
      expect(types).toContain("turn/start");
      expect(types).toContain("assistant/message");
      expect(types).toContain("turn/end");
      await prepared.close();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes a session from disk and continues with a live binding", async () => {
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
      const handle = await ctx.agents.create({
        id: "resume-1",
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      const original = handle.agent.session.snapshot();
      await ctx.agents.dispose(handle.agent.id);

      const resumed = await ctx.agents.resume({
        id: "resume-1",
        model: createMockModel(),
        maxSteps: 3,
      });
      expect(resumed.agent.session.snapshotEvents).toEqual(original.events);
      await ctx.agents.dispose(resumed.agent.id);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
