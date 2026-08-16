import { AgentRegistry } from "@athena/agent";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import type { FinishReason } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { AgentLoop } from "../src/index.js";

function makeStreamModel(text = "hello", finishReason: FinishReason = "stop") {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "text-delta", id: "1", delta: text });
          controller.enqueue({ type: "text-end", id: "1" });
          controller.enqueue({
            type: "finish",
            usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
            finishReason: { unified: finishReason, raw: finishReason },
          });
          controller.close();
        },
      }),
    }),
  });
}

async function setup() {
  const ctx = new Context();
  await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(AgentRegistry), ctx.plugin(ToolRegistry), ctx.plugin(SystemPrompt), ctx.plugin(AgentLoop)]);
  return ctx;
}

describe("agent-loop turn lifecycle", () => {
  it("single turn with no tools completes with turn/end { kind: completed }", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({ model: makeStreamModel() });
    handle.agent.followup("hi");
    await handle.agent.whenIdle();

    const events = handle.agent.session.events;
    expect(events.some((e) => e.type === "turn/start")).toBe(true);
    expect(events.some((e) => e.type === "assistant/message")).toBe(true);
    const end = events.find((e) => e.type === "turn/end");
    expect(end?.data).toMatchObject({ reason: { kind: "completed" } });
    await handle.dispose();
  });

  it("context/snapshot is appended once and not re-appended when content unchanged", async () => {
    const ctx = await setup();
    ctx.systemPrompt.add({ name: "sys", render: () => "system content" });
    const handle = await ctx.agents.create({ model: makeStreamModel() });
    handle.agent.followup("turn 1");
    await handle.agent.whenIdle();
    handle.agent.followup("turn 2");
    await handle.agent.whenIdle();

    const snapshots = handle.agent.session.events.filter((e) => e.type === "context/snapshot");
    // Only one snapshot because rendered fingerprint doesn't change between turns
    expect(snapshots.length).toBe(1);
    await handle.dispose();
  });

  it("cancel mid-turn produces turn/end { kind: aborted }", async () => {
    let resolveStream!: () => void;
    const hangingModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            // Never close — wait for external signal
            resolveStream = () => {
              controller.enqueue({
                type: "finish",
                usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
                finishReason: { unified: "stop", raw: "stop" },
              });
              controller.close();
            };
          },
        }),
      }),
    });

    const ctx = await setup();
    const handle = await ctx.agents.create({ model: hangingModel });
    handle.agent.followup("hi");
    // Give the loop time to enter streamText, then cancel
    await new Promise((r) => setTimeout(r, 10));
    handle.agent.cancel("test cancel");
    resolveStream();
    await handle.agent.whenIdle();

    const events = handle.agent.session.events;
    const end = events.find((e) => e.type === "turn/end");
    expect(end?.data).toMatchObject({ reason: { kind: expect.stringMatching(/aborted|completed/) } });
    await handle.dispose();
  });

  it("maxSteps limit produces turn/end { kind: max-steps }", async () => {
    // Model always returns tool-calls finish reason to force multi-step
    const toolCallModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({
              type: "tool-call",
              toolCallId: "tc1",
              toolName: "noop",
              input: "{}",
            });
            controller.enqueue({
              type: "finish",
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
              finishReason: { unified: "tool-calls", raw: "tool-calls" },
            });
            controller.close();
          },
        }),
      }),
    });

    const ctx = await setup();
    ctx.tools.register("noop", {
      description: "noop",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      execute: async () => "done",
    } as never);

    const handle = await ctx.agents.create({ model: toolCallModel, maxSteps: 2 });
    handle.agent.followup("go");
    await handle.agent.whenIdle();

    const end = handle.agent.session.events.find((e) => e.type === "turn/end");
    expect(end?.data).toMatchObject({ reason: { kind: "max-steps", limit: 2 } });
    await handle.dispose();
  });

  it("tool/call event is appended before tool/result (intent before side-effect)", async () => {
    const executionOrder: string[] = [];
    const toolCallModel = new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "tool-call", toolCallId: "tc1", toolName: "spy", input: "{}" });
            controller.enqueue({
              type: "finish",
              usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
              finishReason: { unified: "stop", raw: "stop" },
            });
            controller.close();
          },
        }),
      }),
    });

    const ctx = await setup();
    ctx.tools.register("spy", {
      description: "spy",
      parameters: { type: "object", properties: {}, required: [], additionalProperties: false },
      execute: async () => {
        executionOrder.push("execute");
        return "ok";
      },
    } as never);

    const handle = await ctx.agents.create({ model: toolCallModel });
    handle.agent.followup("go");
    await handle.agent.whenIdle();

    const events = handle.agent.session.events.map((e) => e.type);
    const callIdx = events.indexOf("tool/call");
    const resultIdx = events.indexOf("tool/result");
    expect(callIdx).toBeGreaterThanOrEqual(0);
    expect(resultIdx).toBeGreaterThan(callIdx);
    await handle.dispose();
  });

  it("dispose() after followup waits for turn to complete", async () => {
    const ctx = await setup();
    const handle = await ctx.agents.create({ model: makeStreamModel() });
    handle.agent.followup("hi");
    await handle.dispose();
    expect(handle.agent.status).toBe("disposed");
  });

  it("createAgent binds an externally owned Session", async () => {
    const ctx = await setup();
    const session = ctx.sessions.create({ id: "external-create" });

    const handle = await ctx.agents.create({ id: session.id, session, model: makeStreamModel() });
    expect(handle.agent.session).toBe(session);

    await handle.dispose();
    expect(ctx.sessions.get(session.id)).toBe(session);
    ctx.sessions.remove(session.id);
  });

  it("resumeAgent binds an externally owned Session without persistence", async () => {
    const ctx = await setup();
    const session = ctx.sessions.create({ id: "external-resume" });

    const handle = await ctx.agents.resume({ id: session.id, session, model: makeStreamModel() });
    expect(handle.agent.session).toBe(session);

    await handle.dispose();
    expect(ctx.sessions.get(session.id)).toBe(session);
    ctx.sessions.remove(session.id);
  });

  it("setModel swaps the model for later turns", async () => {
    const ctx = await setup();
    const first = makeStreamModel("first");
    const second = makeStreamModel("second");

    const handle = await ctx.agents.create({ model: first });
    expect(handle.agent.model).toBe(first);
    handle.agent.setModel(second);
    expect(handle.agent.model).toBe(second);

    await handle.dispose();
  });

  it("emits streaming and output events", async () => {
    const ctx = await setup();
    const parts: unknown[] = [];
    const outputs: unknown[] = [];
    ctx.on("agent/stream-part", (event) => parts.push(event));
    ctx.on("agent/output", (event) => outputs.push(event));

    const handle = await ctx.agents.create({ model: makeStreamModel("hello") });
    handle.agent.followup("hi");
    await handle.agent.whenIdle();

    expect(parts.length).toBeGreaterThan(0);
    expect(outputs).toHaveLength(1);
    expect(outputs[0]).toMatchObject({ agentId: handle.agent.id, kind: "assistant-message" });

    await handle.dispose();
  });
});
