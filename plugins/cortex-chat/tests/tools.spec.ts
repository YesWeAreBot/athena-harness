import { ToolRegistry } from "@athena-ai/core";
import { NerveService } from "@athena-ai/protocol";
import { IMBody, Channel } from "@athena-ai/protocol-im";
import type { Fragment } from "@cordisjs/element";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { MessageStore } from "../src/message-store.js";
import type { CoreToolRuntime, SendMessageInput } from "../src/tools.js";
import { assembleTools, createCoreTools, createSendMessageTool, createWaitTool, createSwitchFocusTool, createPeekChannelTool } from "../src/tools.js";

class FakeBody extends IMBody<void> {
  public override platform: string;
  public sent: Array<{ channelId: string; fragment: Fragment }> = [];
  constructor(ctx: Context, platform: string, selfId: string) {
    super(ctx, undefined);
    this.platform = platform;
    this.selfId = selfId;
    this.status = "online";
  }
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async createMessage(channelId: string, content: Fragment): Promise<Array<{ id: string; content: string }>> {
    this.sent.push({ channelId, fragment: content });
    return [{ id: `mid-${this.platform}-${this.selfId}-${this.sent.length}`, content: String(content) }];
  }
  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: 0 } as Channel;
  }
}

function toolOptions(signal?: AbortSignal) {
  return { abortSignal: signal, toolCallId: "tc1", messages: [] } as unknown as import("ai").ToolExecutionOptions;
}

function makeRuntime(ctx: Context, opts?: { focus?: import("../src/scene.js").SceneAddress | null }): CoreToolRuntime {
  let focus = opts?.focus ?? { bodySid: "fake:alice", channelId: "general" };
  return {
    logicalFocus: () => focus,
    switchFocus: async (target) => {
      focus = target;
      return { ok: true, focus: target };
    },
    peekChannel: async (scene) => {
      return { scene, messages: [] };
    },
    appendWorkspaceDelta: () => {},
  };
}

async function createToolFixture() {
  const ctx = new Context();
  await ctx.plugin(NerveService);
  const body = new FakeBody(ctx, "fake", "alice");
  ctx.nerve.register(body as unknown as import("@athena-ai/protocol").Body<unknown>);
  const runtime = makeRuntime(ctx, { focus: { bodySid: body.sid, channelId: "general" } });
  const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 500, maxTotalDelayMs: 60_000 } });
  return { tool, body, ctx, runtime };
}

describe("tools - send_message modes", () => {
  it("raw mode passes string directly without parsing", async () => {
    const { tool, body } = await createToolFixture();
    const raw = "a <b && c > d & raw";
    const res = await tool.execute({ messages: [raw], mode: "raw" } as SendMessageInput, toolOptions());
    expect(res).toMatchObject({ ok: true, count: 1 });
    expect(body.sent).toHaveLength(1);
    expect(body.sent[0]!.fragment).toBe(raw);
  });

  it("element mode parses canonical string into Fragment", async () => {
    const { tool, body } = await createToolFixture();
    const content = '<at id="123"/> hello';
    const res = await tool.execute({ messages: [content], mode: "element" } as SendMessageInput, toolOptions());
    expect(res).toMatchObject({ ok: true });
    expect(body.sent).toHaveLength(1);
    const frag = body.sent[0]!.fragment as unknown;
    // parsed fragment should be an array containing an Element for at, or normalize will have expanded.
    // At minimum it should not equal raw string when mode=element.
    expect(frag).not.toBe(content);
  });

  it("preserves inner_thought in tool input schema (does not inject provider reasoning)", async () => {
    const { tool } = await createToolFixture();
    const input: Record<string, unknown> = { messages: ["hi"], inner_thought: "my thought" };
    const res = await tool.execute(input as unknown as SendMessageInput, toolOptions());
    expect(res).toMatchObject({ ok: true });
    // Tool description should mention inner_thought when enabled; sendMessageDescription includes it.
    expect(tool.description ?? "").toContain("inner_thought");
  });

  it("honors abortSignal during pacing delay and stops later messages", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new FakeBody(ctx, "fake", "alice");
    ctx.nerve.register(body as unknown as import("@athena-ai/protocol").Body<unknown>);
    const runtime = makeRuntime(ctx, { focus: { bodySid: body.sid, channelId: "general" } });
    const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 1, maxTotalDelayMs: 60_000 } });
    const controller = new AbortController();
    // Enlarge message so paced delay > 250ms
    const long = "x".repeat(2000);
    const promise = tool.execute({ messages: [long, long] } as SendMessageInput, toolOptions(controller.signal));
    // Abort before second message pacing delay resolves
    setTimeout(() => controller.abort(new DOMException("aborted", "AbortError")), 50);
    const res = (await promise) as { ok: boolean; failedAt?: number };
    expect(res.ok).toBe(false);
    expect(body.sent.length).toBeLessThan(2);
  });
});

describe("tools - wait/switch_focus/peek_channel", () => {
  it("wait returns ok and is terminal (tool contract)", async () => {
    const tool = createWaitTool();
    const res = await tool.execute({ reason: "nothing to say" }, toolOptions());
    expect(res).toEqual({ ok: true });
  });

  it("switch_focus calls runtime and returns focus without altering frame directly", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const runtime = makeRuntime(ctx, { focus: { bodySid: "fake:alice", channelId: "general" } });
    const tool = createSwitchFocusTool(runtime);
    const target = { bodySid: "fake:alice", channelId: "other" };
    const res = await tool.execute({ target, reason: "need other" }, toolOptions());
    expect(res).toMatchObject({ ok: true, focus: target });
    expect(runtime.logicalFocus()).toEqual(target);
  });

  it("peek_channel reads canonical content strings and does not change focus", async () => {
    const ctx = new Context();
    await ctx.plugin(Database);
    await ctx.plugin(MemoryDriver);
    // Use a real Life id so MessageStore isolates correctly
    const store = new MessageStore(ctx, "life-peek");
    await store.store({ bodySid: "fake:alice", channelId: "general", messageId: "m1", userId: "u1", content: "hello", timestamp: 100 });
    await store.store({ bodySid: "fake:alice", channelId: "general", messageId: "m2", userId: "u2", content: "world", timestamp: 200 });
    // Runtime peekChannel implementation used by real tool reads from MessageStore; we construct a runtime that delegates to store.
    const runtime: CoreToolRuntime = {
      logicalFocus: () => ({ bodySid: "fake:alice", channelId: "other" }),
      switchFocus: async (target) => ({ ok: true, focus: target }),
      peekChannel: async (scene, limit) => {
        const rows = await store.readScene(scene, { limit });
        return {
          scene,
          messages: rows.map((r) => ({ userId: r.userId, content: r.content, timestamp: r.timestamp })),
        };
      },
      appendWorkspaceDelta: () => {},
    };
    const tool = createPeekChannelTool(runtime);
    const beforeFocus = runtime.logicalFocus();
    const res = await tool.execute({ target: { bodySid: "fake:alice", channelId: "general" }, limit: 1 }, toolOptions());
    expect(res.scene).toEqual({ bodySid: "fake:alice", channelId: "general" });
    expect(res.messages[0]!.content).toBe("world");
    expect(runtime.logicalFocus()).toEqual(beforeFocus);
  });

  it("assembles ToolSet without dynamic prompt data and conflicts fail diagnosably", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    await ctx.plugin(ToolRegistry);
    const body = new FakeBody(ctx, "fake", "alice");
    ctx.nerve.register(body as unknown as import("@athena-ai/protocol").Body<unknown>);
    const runtime = makeRuntime(ctx);
    const core = createCoreTools(ctx, runtime);
    expect(Object.keys(core)).toEqual(expect.arrayContaining(["send_message", "wait", "switch_focus", "peek_channel"]));
    // Core descriptions must not contain dynamic bodySid/channel lists
    const sendDesc = (core as Record<string, { description: string }>).send_message.description;
    expect(sendDesc).not.toContain("fake:alice");
    // Conflict: registered tool with same name as core must throw on assemble
    const ctx2 = new Context();
    await ctx2.plugin(NerveService);
    await ctx2.plugin(ToolRegistry);
    const b2 = new FakeBody(ctx2, "fake", "bob");
    ctx2.nerve.register(b2 as unknown as import("@athena-ai/protocol").Body<unknown>);
    const rt2 = makeRuntime(ctx2);
    const { tool } = await import("@ai-sdk/provider-utils");
    ctx2.tools.register("send_message", tool({ description: "conflict", inputSchema: { type: "object", properties: {} } as never }));
    expect(() => assembleTools(ctx2, rt2)).toThrow(/tool name conflict/i);
  });
});
