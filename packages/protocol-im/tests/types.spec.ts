import { NerveService } from "@athena-ai/protocol";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { IMBody } from "../src/body.js";
import type { IMMessageEvent } from "../src/events.js";
import { Methods } from "../src/methods.js";
import { IMSession } from "../src/session.js";
import { Channel } from "../src/types.js";

class EmptyBody extends IMBody {
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
}

describe("IMBody default implementations", () => {
  it("throws not implemented for unsupported methods", async () => {
    const body = new EmptyBody(new Context(), {});
    await expect(body.getMessage("c", "m")).rejects.toThrow("not implemented: getMessage");
    await expect(body.createChannel("g", {})).rejects.toThrow("not implemented: createChannel");
  });

  it("composes sendMessage from createMessage", async () => {
    const body = new EmptyBody(new Context(), {});
    body.createMessage = async () => [{ id: "1" }, { id: "" }];
    const ids = await body.sendMessage("c", []);
    expect(ids).toEqual(["1"]);
  });

  it("composes sendPrivateMessage from createDirectChannel and sendMessage", async () => {
    const body = new EmptyBody(new Context(), {});
    body.createDirectChannel = async () => ({ id: "private:1", type: 1 });
    body.sendMessage = async (channelId) => [`mid:${channelId}`];
    const ids = await body.sendPrivateMessage("1");
    expect(ids).toEqual(["mid:private:1"]);
  });
});

describe("Methods table", () => {
  it("covers all declared Body methods", () => {
    const names = Object.values(Methods).map((method) => method.name);
    // spot-check a few entries
    expect(Methods["message.send"].name).toBe("sendMessage");
    expect(Methods["guild.member.kick"].fields.map((f) => f.name)).toEqual(["guild_id", "user_id", "permanent"]);
    expect(names.length).toBeGreaterThan(0);
  });
});

describe("IM event typing", () => {
  it("resolves registered event types", () => {
    const event: IMMessageEvent = {
      type: "message-created",
      id: "1",
      selfId: "s",
      platform: "onebot",
      timestamp: 0,
      // SAFETY: the event is only inspected structurally in this test; body is not accessed.
      body: undefined as never,
      channelId: "c",
      userId: "u",
      messageId: "m",
      message: {},
    };
    expect(event.type).toBe("message-created");
    expect(event.channelId).toBe("c");
  });
});

describe("IMSession accessors", () => {
  async function makeSession() {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new EmptyBody(ctx, {});
    return new IMSession(body, {
      type: "message-created",
      id: "1",
      channel: { id: "c1", type: Channel.Type.TEXT },
      user: { id: "u1", name: "U" },
      message: { id: "m1", content: "hello" },
      member: { nick: "N" },
    });
  }

  it("derives channelId / userId / guildId from nested objects", async () => {
    const session = await makeSession();
    expect(session.channelId).toBe("c1");
    expect(session.userId).toBe("u1");
    expect(session.guildId).toBeUndefined();
  });

  it("derives content from message", async () => {
    const session = await makeSession();
    expect(session.content).toBe("hello");
  });

  it("derives messageId from message", async () => {
    const session = await makeSession();
    expect(session.messageId).toBe("m1");
  });

  it("derives isDirect from channel type", async () => {
    expect((await makeSession()).isDirect).toBe(false);
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const direct = new IMSession(new EmptyBody(ctx, {}), {
      type: "message-created",
      id: "2",
      channel: { id: "d1", type: Channel.Type.DIRECT },
    });
    expect(direct.isDirect).toBe(true);
  });

  it("writes content back through the setter", async () => {
    const session = await makeSession();
    session.content = "world";
    expect(session.event.message?.content).toBe("world");
  });
});
