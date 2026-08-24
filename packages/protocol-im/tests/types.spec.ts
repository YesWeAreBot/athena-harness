import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { Body, NerveService } from "../../protocol/src/index.js";
import type {} from "../src/index.js";

class FakeBody extends Body<{}> {
  platform = "fake";

  constructor(ctx: Context) {
    super(ctx, {});
    this.selfId = "test";
  }

  async connect() {
    this.online();
  }

  async disconnect() {
    this.offline();
  }

  async sendMessage() {
    return [];
  }

  async sendPrivateMessage() {
    return [];
  }

  async getMessage() {
    return { id: "1" };
  }

  async getMessageList() {
    return { data: [] };
  }

  async deleteMessage() {}

  async createDirectChannel() {
    return { id: "dm:1", type: 1 as const };
  }

  async getChannel() {
    return { id: "ch1", type: 0 as const };
  }

  async getUser() {
    return { id: "u1" };
  }

  async getGuild() {
    return { id: "g1" };
  }

  async getGuildMember() {
    return { user: { id: "u1" } };
  }
}

describe("protocol-im", () => {
  it("adds IM methods to Body through declaration merging", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new FakeBody(ctx);
    expect(await body.sendMessage("ch1", [])).toEqual([]);
  });

  it("registers type-safe IM events on Context", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new FakeBody(ctx);
    ctx.nerve.register(body);

    const received: Array<{ channelId: string }> = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    body.dispatch(
      body.createEvent({
        type: "message-created",
        channelId: "ch1",
        userId: "u1",
        messageId: "m1",
        message: { id: "m1", content: "hello" },
        channel: { id: "ch1", type: 0 },
        user: { id: "u1" },
        isDirect: false,
      }),
    );

    expect(received).toHaveLength(1);
    expect(received[0].channelId).toBe("ch1");
  });
});
