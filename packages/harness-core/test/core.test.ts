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

describe("athena harness core slice", () => {
  it("composes services and creates an agent", async () => {
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

    const model = new MockLanguageModelV4({
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
    const handle = await ctx.agents.create({
      model,
      maxSteps: 3,
    });

    expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent);
    expect(ctx.sessions.get(handle.agent.id)).toBe(handle.agent.session);
    await expect(
      ctx.agents.create({
        id: handle.agent.id,
        model: new MockLanguageModelV4(),
        maxSteps: 3,
      }),
    ).rejects.toThrow(/Agent already exists/);

    const subject = agentEvents(ctx, handle.agent);
    const statuses: string[] = [];
    const outputs: string[] = [];
    const streamParts: Array<{ type?: string }> = [];
    subject.on("agent/status", (event) => statuses.push(event.status));
    subject.on("agent/output", (event) => outputs.push(event.kind));
    subject.on("agent/stream-part", (event) => streamParts.push(event.part as { type?: string }));

    handle.agent.send("user/message", { content: "hello" });
    await handle.agent.whenIdle();
    expect(handle.agent.session.snapshotEvents.length).toBeGreaterThan(1);
    expect(handle.agent.session.snapshotEvents.some((event) => event.type === "user/message")).toBe(true);
    expect(handle.agent.session.snapshotEvents.some((event) => event.type === "assistant/message")).toBe(true);
    expect(handle.agent.status).toBe("idle");
    expect(statuses).toContain("running");
    expect(statuses).toContain("idle");
    expect(outputs).toContain("assistant-message");
    expect(streamParts.some((part) => part.type === "text-delta")).toBe(true);

    await ctx.agents.dispose(handle.agent.id);
    expect(ctx.agents.get(handle.agent.id)).toBeUndefined();
    expect(ctx.sessions.get(handle.agent.id)).toBeUndefined();

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
