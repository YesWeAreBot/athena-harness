import type { Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import type { AgentContext } from "../src/agent/context.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
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

describe("agent scope", () => {
  it("installs and removes agent-scoped contributions through setup", async () => {
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

    let agentContext: AgentContext | undefined;
    const handle = await ctx.agents.create({
      id: "scoped",
      model: createMockModel(),
      maxSteps: 3,
      setup: async (next) => {
        agentContext = next;
        next.tools.register("echo", {} as Tool);
        next.systemPrompt.registerSection("identity", "scoped identity");
        next.modelSurface.registerUserProjector("external/message", (event) => {
          const data = event.data as { text: string };
          return `external:${data.text}`;
        });
      },
    });

    expect(agentContext).toBeDefined();
    expect(ctx.tools.snapshot().echo).toBeUndefined();
    expect(ctx.tools.snapshot(agentContext!.scope).echo).toBeDefined();
    const scopedPrompt = await ctx.systemPrompt.snapshot(agentContext!.scope);
    expect(scopedPrompt.system).toContain("scoped identity");

    handle.agent.send("external/message", { text: "hello" });
    await handle.agent.whenIdle();
    expect(handle.agent.primarySession.snapshotEvents.some((event) => event.type === "external/message")).toBe(true);

    await ctx.agents.dispose(handle.agent.id);
    expect(ctx.tools.snapshot(agentContext!.scope).echo).toBeUndefined();
    const afterDispose = await ctx.systemPrompt.snapshot(agentContext!.scope);
    expect(afterDispose.system).not.toContain("scoped identity");

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
