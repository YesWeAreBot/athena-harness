import { NerveService } from "@athena-ai/protocol";
import type { IMMessageEvent } from "@athena-ai/protocol-im";
import { Element } from "@cordisjs/element";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { dispatchEvent } from "../src/adapter.js";
import { OneBotBody } from "../src/body.js";

const testConfig: OneBotBody.Config = {
  protocol: "ws",
  selfId: "12345",
  endpoint: "ws://localhost:6700",
  responseTimeout: 15000,
  retryTimes: 6,
  retryInterval: 5000,
  retryLazy: 60000,
};

class MockOneBotBody extends OneBotBody {
  public sentMessages: Array<{ target: string; content: unknown }> = [];

  constructor(ctx: Context) {
    super(ctx, testConfig);
  }

  async connect() {
    this.online();
    this.internal._request = async (action, params) => {
      if (action === "send_group_msg" || action === "send_private_msg") {
        this.sentMessages.push({ target: String(params.group_id ?? params.user_id), content: params.message });
        return { status: "ok", retcode: 0, data: { message_id: 42 } };
      }
      if (action === "get_login_info") return { status: "ok", retcode: 0, data: { user_id: 12345, nickname: "Bot" } };
      return { status: "ok", retcode: 0, data: null };
    };
  }

  async disconnect() {
    this.offline();
  }
}

describe("End-to-end message pipeline", () => {
  it("receives, processes, and sends a reply", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    await body.connect();

    ctx.on("message-created", async (event: IMMessageEvent) => {
      await event.body.sendMessage(event.channelId, [Element("text", { content: `echo: ${event.message.content ?? ""}` })]);
    });

    await dispatchEvent(body, {
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: 1,
      group_id: 67890,
      user_id: 11111,
      self_id: 12345,
      time: 1692000,
      message: [{ type: "text", data: { text: "hello" } }],
      sender: { user_id: 11111, nickname: "User", sex: "unknown", age: 0 },
    });

    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(body.sentMessages).toHaveLength(1);
    expect(body.sentMessages[0].target).toBe("67890");
    expect(body.sentMessages[0].content).toContainEqual({ type: "text", data: { text: "echo: hello" } });
  });

  it("finds OneBot bodies by sid through NerveService", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    expect(ctx.nerve.get("onebot:12345")).toBe(body);
  });
});
