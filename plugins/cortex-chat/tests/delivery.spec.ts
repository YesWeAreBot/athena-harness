import type { Body } from "@athena-ai/protocol";
import { NerveService } from "@athena-ai/protocol";
import { IMBody } from "@athena-ai/protocol-im";
import type { Channel, Message } from "@athena-ai/protocol-im";
import type { Fragment } from "@cordisjs/element";
import type { ToolExecutionOptions } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import type { SceneAddress } from "../src/scene.js";
import type { CoreToolRuntime, SendMessageInput } from "../src/tools.js";
import { createSendMessageTool } from "../src/tools.js";

class FakeBody extends IMBody<void> {
  public override platform: string;
  public sent: Array<{ channelId: string; content: Fragment }> = [];
  private failingIndex?: number;
  private count = 0;

  constructor(ctx: Context, platform: string, selfId: string, opts?: { failAt?: number }) {
    super(ctx, undefined);
    this.platform = platform;
    this.selfId = selfId;
    this.status = "online";
    if (opts?.failAt !== undefined) this.failingIndex = opts.failAt;
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async createMessage(channelId: string, content: Fragment): Promise<Message[]> {
    if (this.failingIndex !== undefined && this.count === this.failingIndex) {
      this.count += 1;
      throw Object.assign(new Error("injected send failure"), { name: "SendError" });
    }
    this.sent.push({ channelId, content });
    const idx = this.count++;
    return [{ id: `mid-${this.platform}-${this.selfId}-${idx}`, content: String(content) }];
  }
  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: 0 } as Channel;
  }
}

function toolOptions(signal?: AbortSignal): ToolExecutionOptions {
  return { abortSignal: signal, toolCallId: "tc1", messages: [] } as unknown as ToolExecutionOptions;
}

function runtimeForFocus(focus: SceneAddress | null): CoreToolRuntime {
  return {
    logicalFocus: () => focus,
    switchFocus: async (target) => ({ ok: true, focus: target }),
    peekChannel: async (scene) => ({ scene, messages: [] }),
    appendWorkspaceDelta: () => {},
  };
}

async function createTwoBodyToolFixture() {
  const ctx = new Context();
  await ctx.plugin(NerveService);
  const aliceBody = new FakeBody(ctx, "fake", "alice");
  const bobBody = new FakeBody(ctx, "fake", "bob");
  ctx.nerve.register(aliceBody as Body<unknown>);
  ctx.nerve.register(bobBody as Body<unknown>);
  const runtime = runtimeForFocus(null);
  const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 200, maxTotalDelayMs: 60_000 } });
  return { tool, aliceBody, bobBody, ctx, runtime };
}

async function createToolFixture() {
  const ctx = new Context();
  await ctx.plugin(NerveService);
  const runtime = runtimeForFocus({ bodySid: "fake:alice", channelId: "general" });
  const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 200, maxTotalDelayMs: 60_000 } });
  return { tool, ctx, runtime };
}

async function createFailingBodyToolFixture() {
  const ctx = new Context();
  await ctx.plugin(NerveService);
  const body = new FakeBody(ctx, "fake", "alice", { failAt: 1 });
  ctx.nerve.register(body as Body<unknown>);
  const runtime = runtimeForFocus({ bodySid: body.sid, channelId: "c1" });
  const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 500, maxTotalDelayMs: 60_000 } });
  return { tool, body, ctx, runtime };
}

describe("delivery - explicit Body resolution", () => {
  it("sends through the explicitly selected Body", async () => {
    const { tool, aliceBody, bobBody } = await createTwoBodyToolFixture();
    const result = await tool.execute(
      {
        target: { bodySid: aliceBody.sid, channelId: "same-channel" },
        mode: "element",
        messages: ["hello"],
      } as SendMessageInput,
      toolOptions(),
    );
    expect(result).toMatchObject({ ok: true });
    expect(aliceBody.sent).toHaveLength(1);
    expect(bobBody.sent).toHaveLength(0);
    expect(aliceBody.sent[0]!.channelId).toBe("same-channel");
  });

  it("does not fabricate a message id when a Body is missing", async () => {
    const { tool } = await createToolFixture();
    await expect(
      tool.execute({ target: { bodySid: "missing:body", channelId: "c1" }, messages: ["hello"] } as SendMessageInput, toolOptions()),
    ).resolves.toMatchObject({
      ok: false,
      error: { message: expect.stringContaining("missing:body") },
    });
    // also ensure error contains channelId
    const res = (await tool.execute({ target: { bodySid: "missing:body", channelId: "c1" }, messages: ["hello"] } as SendMessageInput, toolOptions())) as {
      ok: false;
      error: { message: string };
    };
    expect(res.error.message).toContain("c1");
  });

  it("preserves partial success and stops after delivery failure", async () => {
    const { tool, body } = await createFailingBodyToolFixture();
    const result = await tool.execute({ messages: ["one", "two", "three"] } as SendMessageInput, toolOptions());
    expect(result).toMatchObject({ ok: false, sent: [expect.any(String)], failedAt: 1 });
    expect(body.sent).toHaveLength(1);
  });

  it("returns No focus when target omitted and logicalFocus is null", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const runtime = runtimeForFocus(null);
    const tool = createSendMessageTool({ ctx, runtime, pacing: { charactersPerSecond: 200, maxTotalDelayMs: 60_000 } });
    const result = await tool.execute({ messages: ["hi"] } as SendMessageInput, toolOptions());
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining("No focus Scene is available") } });
  });
});
