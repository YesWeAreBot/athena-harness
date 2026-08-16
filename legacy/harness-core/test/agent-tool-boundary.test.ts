import type { Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { agentLoop } from "../src/agent-loop/index.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { sessionStore } from "../src/session/index.js";
import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

function multiToolModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "tool-input-start", id: "2", toolName: "echo" });
          controller.enqueue({ type: "tool-input-delta", id: "2", delta: "{}" });
          controller.enqueue({ type: "tool-input-end", id: "2" });
          controller.enqueue({
            type: "tool-call",
            toolCallId: "call-1",
            toolName: "echo",
            input: "{}",
          });
          controller.enqueue({ type: "tool-input-start", id: "3", toolName: "fail" });
          controller.enqueue({ type: "tool-input-delta", id: "3", delta: "{}" });
          controller.enqueue({ type: "tool-input-end", id: "3" });
          controller.enqueue({
            type: "tool-call",
            toolCallId: "call-2",
            toolName: "fail",
            input: "{}",
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

describe("tool effect boundary", () => {
  it("persists intent before execution and records explicit result statuses", async () => {
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

    let intentVisibleDuringExecution = false;
    let okCalls = 0;
    let errorCalls = 0;
    const okTool: Tool = {
      inputSchema: z.object({}),
      execute: async () => {
        okCalls++;
        const session = ctx.sessions.get("tool-boundary");
        intentVisibleDuringExecution ||= !!session?.snapshotEvents.some((event) => event.type === "tool/call");
        return "ok";
      },
    };
    const failTool: Tool = {
      inputSchema: z.object({}),
      execute: async () => {
        errorCalls++;
        throw new Error("boom");
      },
    };
    ctx.tools.register("echo", okTool);
    ctx.tools.register("fail", failTool);

    try {
      const handle = await ctx.agents.create({
        id: "tool-boundary",
        model: multiToolModel(),
        maxSteps: 1,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();

      const results = handle.agent.primarySession.snapshotEvents.filter((event) => event.type === "tool/result");
      expect(results.map((event) => (event.data as { status: string }).status)).toEqual(["ok", "error"]);
      expect(okCalls).toBe(1);
      expect(errorCalls).toBe(1);
      expect(intentVisibleDuringExecution).toBe(true);

      await ctx.agents.dispose(handle.agent.id);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
