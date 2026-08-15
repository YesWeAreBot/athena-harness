import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import { agentEvents } from "../src/agent/events.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { sessionStore } from "../src/session/index.js";
import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

function hangingModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async ({ abortSignal }) => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          abortSignal?.addEventListener(
            "abort",
            () => {
              controller.error(abortSignal.reason ?? new Error("aborted"));
            },
            { once: true },
          );
        },
      }),
    }),
  });
}

describe("agent cancel", () => {
  it("aborts the active turn and closes it with a structured reason", async () => {
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

    try {
      const handle = await ctx.agents.create({
        id: "cancel-1",
        model: hangingModel(),
        maxSteps: 3,
      });
      const subject = agentEvents(ctx, handle.agent);
      const started = new Promise<void>((resolve) => {
        subject.on("agent/stream-part", () => resolve());
      });

      handle.agent.send("user/message", { content: "hello" });
      await started;
      handle.agent.cancel("user stop");
      await handle.agent.whenIdle();

      const end = handle.agent.primarySession.snapshotEvents.find((event) => event.type === "turn/end");
      expect(end?.data).toMatchObject({
        reason: { kind: "aborted", cause: "user stop" },
      });
      expect(handle.agent.status).toBe("idle");

      await ctx.agents.dispose(handle.agent.id);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
