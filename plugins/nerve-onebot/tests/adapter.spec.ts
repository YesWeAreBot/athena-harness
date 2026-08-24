import { NerveService } from "@athena-ai/protocol";
import type { IMMessageEvent } from "@athena-ai/protocol-im";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { dispatchEvent } from "../src/adapter.js";
import { OneBotBody } from "../src/body.js";

class TestOneBotBody extends OneBotBody {
  async connect() {
    this.online();
  }

  async disconnect() {
    this.offline();
  }
}

describe("dispatchEvent", () => {
  it("converts group messages to IMMessageEvent", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new TestOneBotBody(ctx, { selfId: "12345" });
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    dispatchEvent(body, {
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: 999,
      group_id: 67890,
      user_id: 11111,
      self_id: 12345,
      time: 1692000,
      message: [{ type: "text", data: { text: "hello" } }],
      raw_message: "hello",
      font: 0,
      sender: { user_id: 11111, nickname: "TestUser", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("message-created");
    expect(received[0].channelId).toBe("67890");
    expect(received[0].guildId).toBe("67890");
    expect(received[0].userId).toBe("11111");
    expect(received[0].isDirect).toBe(false);
    expect(received[0].message.content).toBe("hello");
    expect(received[0].user.name).toBe("TestUser");
  });

  it("converts private messages to direct channels", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new TestOneBotBody(ctx, { selfId: "12345" });
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    dispatchEvent(body, {
      post_type: "message",
      message_type: "private",
      sub_type: "friend",
      message_id: 100,
      user_id: 22222,
      self_id: 12345,
      time: 1692000,
      message: [{ type: "text", data: { text: "hi" } }],
      raw_message: "hi",
      font: 0,
      sender: { user_id: 22222, nickname: "Friend", sex: "unknown", age: 0 },
    });

    expect(received).toHaveLength(1);
    expect(received[0].channelId).toBe("private:22222");
    expect(received[0].isDirect).toBe(true);
    expect(received[0].guildId).toBeUndefined();
  });

  it("ignores non-message events reserved for future migration", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new TestOneBotBody(ctx, { selfId: "12345" });
    ctx.nerve.register(body);

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => {
      received.push(event);
    });

    dispatchEvent(body, {
      post_type: "notice",
      notice_type: "group_increase",
      self_id: 12345,
      time: 1692000,
      user_id: 33333,
      group_id: 67890,
    });

    expect(received).toHaveLength(0);
  });
});
