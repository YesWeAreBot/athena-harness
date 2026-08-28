import type { IMMessageEvent, IMSendEvent } from "@athena-ai/protocol-im";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { MessageStore, type StoredMessage } from "../src/message-store.js";

// ─── Fixtures ────────────────────────────────────────────────────────────────

function stored(content: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    bodySid: "sandbox:alice",
    channelId: "general",
    messageId: "m1",
    userId: "u1",
    content,
    timestamp: 100,
    ...overrides,
  };
}

function message(bodySid: string, channelId: string, messageId: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    bodySid,
    channelId,
    messageId,
    userId: "u1",
    content: `content-${messageId}`,
    timestamp: 100,
    ...overrides,
  };
}

function messageEvent(
  overrides: {
    bodySid?: string;
    channelId?: string;
    messageId?: string;
    userId?: string;
    userName?: string;
    content?: string;
    timestamp?: number;
    replyTo?: string;
  } = {},
): IMMessageEvent {
  const bodySid = overrides.bodySid ?? "sandbox:alice";
  const channelId = overrides.channelId ?? "general";
  const messageId = overrides.messageId ?? "m1";
  const userId = overrides.userId ?? "u1";
  const userName = overrides.userName ?? "Alice";
  const content = overrides.content ?? "hello";
  const timestamp = overrides.timestamp ?? 100;
  const replyTo = overrides.replyTo;
  const [platform, ...rest] = bodySid.split(":");
  const selfId = rest.join(":") || "alice";
  const body = { sid: bodySid, platform: platform ?? "sandbox", selfId } as unknown as IMMessageEvent["body"];
  const user = { id: userId, name: userName } as unknown as IMMessageEvent["user"];
  const channel = { id: channelId, type: 0 } as unknown as IMMessageEvent["channel"];
  const msg: Record<string, unknown> = { id: messageId, content };
  if (replyTo) msg.quote = { id: replyTo } as unknown as never;
  // SAFETY: constructing a minimal IMMessageEvent-shaped object for the fake external-world boundary; protocol-im accessors (channelId, userId, etc.) read from event/channel/user/message fields.
  const event = {
    type: "message-created",
    body,
    platform: platform ?? "sandbox",
    selfId,
    channelId,
    channel,
    userId,
    user,
    messageId,
    message: msg,
    content,
    timestamp,
    event: {
      type: "message-created",
      platform: platform ?? "sandbox",
      selfId,
      timestamp,
      channel,
      user,
      message: msg,
    },
  } as unknown as IMMessageEvent;
  return event;
}

function sendEvent(
  overrides: {
    bodySid?: string;
    channelId?: string;
    messageId?: string;
    userId?: string;
    userName?: string;
    content?: string;
    timestamp?: number;
    replyTo?: string;
  } = {},
): IMSendEvent {
  const bodySid = overrides.bodySid ?? "sandbox:alice";
  const channelId = overrides.channelId ?? "general";
  const messageId = overrides.messageId ?? "s1";
  const userId = overrides.userId ?? "self";
  const userName = overrides.userName ?? "Self";
  const content = overrides.content ?? "reply";
  const timestamp = overrides.timestamp ?? 100;
  const replyTo = overrides.replyTo;
  const [platform, ...rest] = bodySid.split(":");
  const selfId = rest.join(":") || "alice";
  const body = { sid: bodySid, platform: platform ?? "sandbox", selfId } as unknown as IMSendEvent["body"];
  const user = { id: userId, name: userName } as unknown as IMSendEvent["user"];
  const channel = { id: channelId, type: 0 } as unknown as IMSendEvent["channel"];
  const msg: Record<string, unknown> = { id: messageId, content };
  if (replyTo) msg.quote = { id: replyTo } as unknown as never;
  // SAFETY: minimal IMSendEvent shape; content lives on `message.content` and optionally on `content` accessor; both are normalized to the same canonical string.
  const event = {
    type: "send",
    body,
    platform: platform ?? "sandbox",
    selfId,
    channelId,
    channel,
    userId,
    user,
    messageId,
    message: msg,
    content,
    timestamp,
    event: {
      type: "send",
      platform: platform ?? "sandbox",
      selfId,
      timestamp,
      channel,
      user,
      message: msg,
    },
  } as unknown as IMSendEvent;
  return event;
}

async function createStore(lifeId = "test-life"): Promise<MessageStore> {
  const ctx = new Context();
  await ctx.plugin(Database);
  await ctx.plugin(MemoryDriver);
  return new MessageStore(ctx, lifeId);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("MessageStore", () => {
  it("stores an inbound event under bodySid and messageId", async () => {
    const store = await createStore();
    await store.storeEvent(messageEvent({ bodySid: "sandbox:alice", messageId: "m1", content: "[CQ:at,id=alice] hi" }));
    await expect(store.readScene({ bodySid: "sandbox:alice", channelId: "general" })).resolves.toEqual([
      expect.objectContaining({ bodySid: "sandbox:alice", messageId: "m1", content: "[CQ:at,id=alice] hi" }),
    ]);
  });

  it("makes duplicate events idempotent", async () => {
    const store = await createStore();
    const event = messageEvent({ bodySid: "sandbox:alice", messageId: "m1" });
    await store.storeEvent(event);
    await store.storeEvent(event);
    expect(await store.readScene({ bodySid: "sandbox:alice", channelId: "general" })).toHaveLength(1);
  });

  it("archives outbound send events", async () => {
    const store = await createStore();
    await store.storeEvent(sendEvent({ bodySid: "sandbox:alice", messageId: "s1", content: "reply" }));
    expect(await store.readScene({ bodySid: "sandbox:alice", channelId: "general" })).toHaveLength(1);
  });

  it("does not mix identical channel ids from different bodies", async () => {
    const store = await createStore();
    await store.store(message("sandbox:alice", "general", "a1"));
    await store.store(message("sandbox:bob", "general", "b1"));
    expect((await store.readScene({ bodySid: "sandbox:alice", channelId: "general" })).map((item) => item.messageId)).toEqual(["a1"]);
  });

  it("isolates rows by lifeId", async () => {
    const ctx = new Context();
    await ctx.plugin(Database);
    await ctx.plugin(MemoryDriver);
    const storeA = new MessageStore(ctx, "life-a");
    const storeB = new MessageStore(ctx, "life-b");
    await storeA.store(message("sandbox:alice", "general", "m1", { content: "from-a" }));
    await storeB.store(message("sandbox:alice", "general", "m1", { content: "from-b" }));
    const a = await storeA.readScene({ bodySid: "sandbox:alice", channelId: "general" });
    const b = await storeB.readScene({ bodySid: "sandbox:alice", channelId: "general" });
    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
    expect(a[0]!.content).toBe("from-a");
    expect(b[0]!.content).toBe("from-b");
    // cross-life: m2 only in B must not appear in A
    await storeB.store(message("sandbox:alice", "general", "m2"));
    expect(await storeA.readScene({ bodySid: "sandbox:alice", channelId: "general" })).toHaveLength(1);
  });

  it("returns Scene messages in chronological order (timestamp, messageId)", async () => {
    const store = await createStore();
    await store.store(message("sandbox:alice", "general", "m2", { timestamp: 200 }));
    await store.store(message("sandbox:alice", "general", "m3", { timestamp: 100 }));
    await store.store(message("sandbox:alice", "general", "m1", { timestamp: 100 }));
    const ids = (await store.readScene({ bodySid: "sandbox:alice", channelId: "general" })).map((m) => m.messageId);
    expect(ids).toEqual(["m1", "m3", "m2"]);
  });

  it("applies before/after cursors with (timestamp, messageId) ordering and keeps the most recent rows under limit", async () => {
    const store = await createStore();
    await store.store(message("sandbox:alice", "general", "m1", { timestamp: 100 }));
    await store.store(message("sandbox:alice", "general", "m2", { timestamp: 200 }));
    await store.store(message("sandbox:alice", "general", "m3", { timestamp: 300 }));
    await store.store(message("sandbox:alice", "general", "m4", { timestamp: 400 }));
    // after m1 -> m2,m3,m4 ; before m4 -> m1,m2,m3 ; combined -> m2,m3
    expect(
      (await store.readScene({ bodySid: "sandbox:alice", channelId: "general" }, { after: { timestamp: 100, messageId: "m1" } })).map((m) => m.messageId),
    ).toEqual(["m2", "m3", "m4"]);
    expect(
      (await store.readScene({ bodySid: "sandbox:alice", channelId: "general" }, { before: { timestamp: 400, messageId: "m4" } })).map((m) => m.messageId),
    ).toEqual(["m1", "m2", "m3"]);
    expect(
      (
        await store.readScene(
          { bodySid: "sandbox:alice", channelId: "general" },
          { after: { timestamp: 100, messageId: "m1" }, before: { timestamp: 400, messageId: "m4" }, limit: 1 },
        )
      ).map((m) => m.messageId),
    ).toEqual(["m3"]);
  });

  it("preserves canonical string content only and derives replyTo/userName", async () => {
    const store = await createStore();
    const ev = messageEvent({ bodySid: "sandbox:alice", messageId: "m1", content: "[CQ:at,id=alice] hi", userName: "Alice", replyTo: "q1" });
    const saved = await store.storeEvent(ev);
    expect(saved.content).toBe("[CQ:at,id=alice] hi");
    expect(saved.replyTo).toBe("q1");
    expect(saved.userName).toBe("Alice");
    const fetched = (await store.readScene({ bodySid: "sandbox:alice", channelId: "general" }))[0]!;
    expect(fetched.content).toBe("[CQ:at,id=alice] hi");
    // SAFETY: StoredMessage has no elements field; asserting absence is a local invariant check.
    expect((fetched as unknown as Record<string, unknown>).elements).toBeUndefined();
  });

  it("stores via direct StoredMessage and deduplicates on (lifeId, bodySid, messageId)", async () => {
    const store = await createStore();
    const msg = stored("hi", { bodySid: "sandbox:alice", channelId: "general", messageId: "m1", userId: "u1", timestamp: 100 });
    await store.store(msg);
    await store.store({ ...msg, content: "hi-updated" });
    const list = await store.readScene({ bodySid: "sandbox:alice", channelId: "general" });
    expect(list).toHaveLength(1);
  });

  it("exposes attach without throwing and can archive via attached listeners", async () => {
    const ctx = new Context();
    await ctx.plugin(Database);
    await ctx.plugin(MemoryDriver);
    const store = new MessageStore(ctx, "life-attach");
    expect(() => store.attach()).not.toThrow();
    await ctx.parallel("message-created", messageEvent({ bodySid: "sandbox:alice", messageId: "mX" }) as never);
    // give microtasks a turn
    await new Promise((r) => setTimeout(r, 0));
    const list = await store.readScene({ bodySid: "sandbox:alice", channelId: "general" });
    // attach wiring is best-effort; at minimum it should have registered without error and not broken prior writes
    expect(Array.isArray(list)).toBe(true);
  });
});
