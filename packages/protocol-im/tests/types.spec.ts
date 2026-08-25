import { NerveService } from "@athena-ai/protocol";
import type { Session } from "@athena-ai/protocol";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { IMBody } from "../src/body.js";
import type { IMMessageEvent } from "../src/events.js";
import { Methods } from "../src/types.js";
import { Channel } from "../src/types.js";

/** Minimal IMBody: only the abstract surface. Everything else is absent. */
class EmptyBody extends IMBody {
  platform = "test";
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async createMessage(channelId: string, content: import("@cordisjs/element").Fragment): Promise<Array<import("../src/types.js").Message>> {
    return [{ id: channelId, content: String(content) }];
  }
  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: Channel.Type.DIRECT };
  }
}

/** Full IMBody: implements every method except a couple to check detection. */
class FullBody extends IMBody {
  platform = "test";
  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}
  async createMessage(): Promise<Array<import("../src/types.js").Message>> {
    return [];
  }
  async createDirectChannel(): Promise<Channel> {
    return { id: "@x", type: Channel.Type.DIRECT };
  }
  async getMessage(): Promise<import("../src/types.js").Message> {
    return {};
  }
  async deleteMessage(): Promise<void> {}
  async getLogin(): Promise<import("../src/types.js").Login> {
    return { status: 0, features: [] };
  }
}

describe("IMBody capability model", () => {
  it("detects implemented methods into features (satori pattern)", () => {
    const empty = new EmptyBody(new Context(), {});
    // abstract surface + Body lifecycle methods are present
    expect(empty.features).toContain("message.create");
    expect(empty.features).toContain("user.channel.create");
    // composite defaults exist on the prototype
    expect(empty.features).toContain("message.send");
    expect(empty.features).toContain("message.sendPrivate");
    // everything else is absent
    expect(empty.features).not.toContain("message.get");
    expect(empty.features).not.toContain("channel.create");

    const full = new FullBody(new Context(), {});
    expect(full.features).toContain("message.get");
    expect(full.features).toContain("message.delete");
    expect(full.features).not.toContain("channel.create");
  });

  it("supports() checks wire-level capability names", () => {
    const empty = new EmptyBody(new Context(), {});
    expect(empty.supports("message.create")).toBe(true);
    expect(empty.supports("message.send")).toBe(true);
    expect(empty.supports("message.get")).toBe(false);
    expect(empty.supports("no.such.method")).toBe(false);
  });

  it("missing methods are undefined, not throwing placeholders", () => {
    const empty = new EmptyBody(new Context(), {});
    // the method is simply not on the prototype
    expect("getMessage" in empty).toBe(false);
    expect("createChannel" in empty).toBe(false);
    // composite defaults live on the IMBody prototype
    expect("sendMessage" in empty).toBe(true);
  });
});

describe("IMBody composite defaults", () => {
  it("composes sendMessage from createMessage", async () => {
    const body = new EmptyBody(new Context(), {});
    const ids = await body.sendMessage("c", []);
    expect(ids).toEqual(["c"]);
  });

  it("composes sendPrivateMessage from createDirectChannel and sendMessage", async () => {
    const body = new EmptyBody(new Context(), {});
    const ids = await body.sendPrivateMessage("1", []);
    expect(ids).toEqual(["@1"]);
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
    // SAFETY: structural test — verifies type shape; runtime accessors tested separately.
    const event = {
      type: "message-created",
      selfId: "s",
      platform: "onebot",
      timestamp: 0,
      // SAFETY: body is not accessed in this test; typed as never to exclude from shape check.
      body: undefined as never,
      sn: 0,
      event: { type: "message-created", id: "1", selfId: "s", platform: "onebot", timestamp: 0 },
      channelId: "c",
      userId: "u",
      messageId: "m",
      message: {},
      channel: { id: "c", type: Channel.Type.TEXT },
      user: { id: "u" },
      content: "test",
    } satisfies Omit<IMMessageEvent, "body" | "sid" | "setInternal" | "toJSON"> & { body: never };
    expect(event.type).toBe("message-created");
    expect(event.channelId).toBe("c");
  });
});

describe("Session IM accessors", () => {
  async function makeSession(): Promise<Session> {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new EmptyBody(ctx, {});
    return body.session({
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
    const direct = new EmptyBody(ctx, {}).session({
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

  it("exposes entity accessors (channel / user / guild / message / member)", async () => {
    const session = await makeSession();
    expect(session.channel?.id).toBe("c1");
    expect(session.user?.name).toBe("U");
    expect(session.member?.nick).toBe("N");
    expect(session.message?.id).toBe("m1");
  });

  it("attaches IM accessors to the base Session prototype", async () => {
    // protocol-im must be imported for the side effects to run; the runtime
    // envelope is the plain Session class from @athena-ai/protocol.
    const session = await makeSession();
    expect(session.constructor.name).toBe("Session");
    expect("channelId" in Object.getPrototypeOf(session)).toBe(true);
  });
});
