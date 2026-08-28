import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { ToolRegistry } from "@athena-ai/core";
import { Channel, IMBody } from "@athena-ai/protocol-im";
import type { IMMessageEvent, IMSendEvent, Message } from "@athena-ai/protocol-im";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context, Service } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import Life from "../../life/src/index.js";
import { CheckpointStore, createCheckpoint } from "../src/checkpoint.js";
import CortexChat from "../src/index.js";
import type { SceneAddress } from "../src/scene.js";

class FakeAI extends Service {
  constructor(ctx: Context) {
    super(ctx, "ai");
  }

  language() {
    return {};
  }
}

class FakeIMBody extends IMBody<void> {
  public override platform = "sandbox";

  constructor(ctx: Context) {
    super(ctx, undefined);
    this.selfId = "alice";
    this.status = "online";
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async createMessage(_channelId: string, _content: import("@cordisjs/element").Fragment): Promise<Message[]> {
    return [];
  }

  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: Channel.Type.DIRECT };
  }
}

function deferred<T>() {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

/** Poll until a deadline: restoration and archiving await real file and database I/O. */
async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let failure: unknown;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      failure = error;
    }
    if (Date.now() >= deadline) throw failure;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

async function createContext(): Promise<Context> {
  const ctx = new Context();
  await ctx.plugin(Database);
  await ctx.plugin(MemoryDriver);
  await ctx.plugin(FakeAI);
  await ctx.plugin(ToolRegistry);
  await ctx.plugin(Life, { id: "alice", dataDir: mkdtempSync(path.join(tmpdir(), "athena-cortex-chat-lifecycle-")) });
  return ctx;
}

function scene(): SceneAddress {
  return { bodySid: "sandbox:alice", channelId: "general" };
}

function messageEvent(body: FakeIMBody, content: string, id: string): IMMessageEvent {
  return body.session({
    id: `event-${id}`,
    type: "message-created",
    channel: { id: "general", type: Channel.Type.TEXT },
    user: { id: "user", name: "User" },
    message: { id, content },
  }) as IMMessageEvent;
}

function sendEvent(body: FakeIMBody, content: string, id: string): IMSendEvent {
  return body.session({
    id: `event-${id}`,
    type: "send",
    channel: { id: "general", type: Channel.Type.TEXT },
    user: { id: "alice", name: "Alice" },
    message: { id, content },
  }) as IMSendEvent;
}

describe("CortexChat lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("restores checkpoint focus as both frame and logical focus", async () => {
    const ctx = await createContext();
    const store = new CheckpointStore(ctx);
    await store.save(
      createCheckpoint({
        focus: scene(),
        history: [{ role: "user", content: "frozen frame" }],
        lastFocusHistory: [],
        compaction: "persisted summary",
      }),
    );

    const fiber = await ctx.plugin(CortexChat, { idleTimeout: 0 });
    await waitFor(() => {
      expect(ctx.cortex.attention.snapshot()).toMatchObject({ frameFocus: scene(), logicalFocus: scene() });
    });
    await fiber.dispose();
  });

  it("does not archive messages until persistence restoration completes", async () => {
    const gate = deferred<void>();
    vi.spyOn(CheckpointStore.prototype, "load").mockImplementationOnce(async () => {
      await gate.promise;
      return null;
    });

    const ctx = await createContext();
    const body = new FakeIMBody(ctx);
    const fiber = await ctx.plugin(CortexChat, { idleTimeout: 0 });

    ctx.emit("message-created", messageEvent(body, "before restore", "before"));
    await flushPromises();
    expect(await ctx.cortex.messages.readScene(scene())).toEqual([]);

    gate.resolve();
    await ctx.cortex.ready;
    ctx.emit("message-created", messageEvent(body, "after restore", "after"));

    await waitFor(async () => {
      expect(await ctx.cortex.messages.readScene(scene())).toEqual([expect.objectContaining({ content: "after restore" })]);
    });
    await fiber.dispose();
  });

  it("archives inbound and outbound messages without routing outbound events", async () => {
    const ctx = await createContext();
    const body = new FakeIMBody(ctx);
    const fiber = await ctx.plugin(CortexChat, { idleTimeout: 0 });
    await ctx.cortex.ready;

    ctx.emit("message-created", messageEvent(body, "background", "inbound"));
    ctx.emit("send", sendEvent(body, "outbound", "outbound"));

    await waitFor(async () => {
      expect(await ctx.cortex.messages.readScene(scene())).toEqual(
        expect.arrayContaining([expect.objectContaining({ content: "background" }), expect.objectContaining({ content: "outbound" })]),
      );
    });
    expect(ctx.cortex.coordinator.active()).toBeNull();
    await fiber.dispose();
  });

  it("stops the coordinator and clears idle timers on disposal", async () => {
    const ctx = await createContext();
    const body = new FakeIMBody(ctx);
    const fiber = await ctx.plugin(CortexChat, { idleTimeout: 10_000 });
    await flushPromises();

    vi.useFakeTimers();
    ctx.emit("message-created", messageEvent(body, "start", "start"));
    await vi.advanceTimersByTimeAsync(0);
    const cortex = ctx.cortex;
    await fiber.dispose();

    expect(cortex.coordinator.active()).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
});
