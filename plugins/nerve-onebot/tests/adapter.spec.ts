import { NerveService } from "@athena-ai/protocol";
import type { IMGuildMemberEvent, IMMessageEvent } from "@athena-ai/protocol-im";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { dispatchEvent } from "../src/adapter.js";
import { OneBotBody } from "../src/body.js";
import type * as OneBot from "../src/types.js";

const testConfig: OneBotBody.Config = {
  protocol: "ws",
  selfId: "12345",
  endpoint: "ws://localhost:6700",
  responseTimeout: 15000,
  retryTimes: 6,
  retryInterval: 5000,
  retryLazy: 60000,
};

describe("dispatchEvent", () => {
  it("converts group messages to IMMessageEvent", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    await dispatchEvent(body, {
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: 999,
      group_id: 67890,
      user_id: 11111,
      self_id: 12345,
      time: 1692000,
      message: [{ type: "text", data: { text: "hello" } }],
      sender: { user_id: 11111, nickname: "TestUser", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("message-created");
    expect(received[0].channelId).toBe("67890");
    expect(received[0].guildId).toBe("67890");
    expect(received[0].userId).toBe("11111");
    expect(received[0].isDirect).toBe(false);
    expect(received[0].message.content).toBe("hello");
    expect(received[0].user!.name).toBe("TestUser");
  });

  it("serializes non-text elements into content and splits quote (koishi semantics)", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    await dispatchEvent(body, {
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: 1000,
      group_id: 67890,
      user_id: 11111,
      self_id: 12345,
      time: 1692000,
      message: [
        { type: "reply", data: { id: "555" } },
        { type: "at", data: { qq: "22222" } },
        { type: "text", data: { text: " hi" } },
      ],
      sender: { user_id: 11111, nickname: "TestUser", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    // quote element is split out; fetching the quoted message fails in this
    // test (no internal bridge), so quote stays undefined and the reply
    // element is gone from content.
    expect(received[0].message.quote).toBeUndefined();
    expect(received[0].message.content).toBe('<at qq="22222"/> hi');
    expect(received[0].message.elements?.[0].type).toBe("at");
  });

  it("converts private messages to direct channels", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    await dispatchEvent(body, {
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      message_id: 100,
      user_id: 22222,
      self_id: 12345,
      time: 1692000,
      message: [{ type: "text", data: { text: "hi" } }],
      sender: { user_id: 22222, nickname: "Friend", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].channelId).toBe("private:22222");
    expect(received[0].isDirect).toBe(true);
    expect(received[0].guildId).toBeUndefined();
  });

  it("dispatches notice events as guild-member events", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMGuildMemberEvent[] = [];
    ctx.on("guild-member-added", (event) => {
      received.push(event);
    });

    await dispatchEvent(body, {
      post_type: "notice",
      notice_type: "group_increase",
      sub_type: "approve",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      group_id: 67890,
      message_id: 0,
      message_type: "group",
      message: "",
      sender: { user_id: 33333, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("guild-member-added");
    expect(received[0].userId).toBe("33333");
    expect(received[0].guildId).toBe("67890");
  });

  it("dispatches request events as friend-request", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: unknown[] = [];
    ctx.on("friend-request", (event) => {
      received.push(event);
    });

    await dispatchEvent(body, {
      post_type: "request",
      request_type: "friend",
      sub_type: "",
      self_id: 12345,
      time: 1692000,
      user_id: 44444,
      flag: "req_123",
      comment: "Please add me",
      message_id: 0,
      message_type: "private",
      message: "",
      sender: { user_id: 44444, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
  });

  it("maps group_recall to message-deleted", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-deleted", (event) => {
      // SAFETY: the dispatched event is a message-deleted Session, which is IMMessageEvent-shaped.
      received.push(event as IMMessageEvent);
    });

    await dispatchEvent(body, {
      post_type: "notice",
      notice_type: "group_recall",
      sub_type: "",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      group_id: 67890,
      message_id: 555,
      message_type: "group",
      message: "",
      sender: { user_id: 33333, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("message-deleted");
    expect(received[0].messageId).toBe("555");
    expect(received[0].subtype).toBe("group");
  });

  it("maps friend_recall to message-deleted with private channel", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-deleted", (event) => {
      // SAFETY: the dispatched event is a message-deleted Session, which is IMMessageEvent-shaped.
      received.push(event as IMMessageEvent);
    });

    await dispatchEvent(body, {
      post_type: "notice",
      notice_type: "friend_recall",
      sub_type: "",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      message_id: 556,
      message_type: "private",
      message: "",
      sender: { user_id: 33333, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].channelId).toBe("private:33333");
    expect(received[0].subtype).toBe("private");
  });

  it("maps notify/poke to internal with private channel fallback", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: Array<{ type: string; channelId?: string; _type?: string; data?: OneBot.Payload }> = [];
    ctx.on("onebot/poke", (data, source) => {
      // SAFETY: internal events are emitted under their `_type` with `_data` payload (satori pattern).
      received.push({ type: "internal", _type: "onebot/poke", channelId: source.sid, data });
    });

    await dispatchEvent(body, {
      post_type: "notice",
      notice_type: "notify",
      sub_type: "poke",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      group_id: 67890,
      message_type: "group",
      message: "",
      sender: { user_id: 33333, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("internal");
    expect(received[0]._type).toBe("onebot/poke");
    expect(received[0].channelId).toBe("onebot:12345");
    expect(received[0].data).toMatchObject({ notice_type: "notify", sub_type: "poke" });
  });

  it("ignores unknown notice types", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    let dispatched = 0;
    ctx.on("onebot/poke", () => dispatched++);
    ctx.on("message-deleted", () => dispatched++);

    await dispatchEvent(body, {
      post_type: "notice",
      notice_type: "some_unknown_type",
      sub_type: "",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      group_id: 67890,
      message_type: "group",
      message: "",
      sender: { user_id: 33333, nickname: "", sex: "unknown", age: 0 },
    });

    expect(dispatched).toBe(0);
  });

  it("maps request sub_type add to guild-member-request", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new OneBotBody(ctx, testConfig);
    ctx.nerve.register(body);

    const received: Array<{ type: string }> = [];
    ctx.on("guild-member-request", (event) => {
      // SAFETY: the dispatched event is a guild-member-request Session carrying the type under test.
      received.push(event as { type: string });
    });

    await dispatchEvent(body, {
      post_type: "request",
      request_type: "group",
      sub_type: "add",
      self_id: 12345,
      time: 1692000,
      user_id: 44444,
      group_id: 67890,
      flag: "req_456",
      comment: "Please add me",
      message_type: "group",
      message: "",
      sender: { user_id: 44444, nickname: "", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("guild-member-request");
  });
});
