import { NerveService } from "@athena-ai/protocol";
import type { IMMessageEvent, IMSendEvent } from "@athena-ai/protocol-im";
import { Element, parse } from "@cordisjs/element";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { OneBotBody } from "../src/bot/index.js";
import { dispatchSession } from "../src/utils.js";

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
  public forwardedMessages: unknown[] = [];
  public uploadedFiles: Array<{ target: string; file: string; name: string }> = [];

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
      if (action === "send_group_forward_msg" || action === "send_private_forward_msg") {
        this.forwardedMessages.push(params.messages);
        return { status: "ok", retcode: 0, data: { message_id: 43 } };
      }
      if (action === "download_file") return { status: "ok", retcode: 0, data: { file: "/tmp/downloaded-file" } };
      if (action === "upload_group_file" || action === "upload_private_file") {
        this.uploadedFiles.push({ target: String(params.group_id ?? params.user_id), file: String(params.file), name: String(params.name) });
        return { status: "ok", retcode: 0, data: null };
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

    await dispatchSession(body, {
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

  /**
   * The canonical-content contract a Cortex archive depends on: one `content`
   * string per message, in Athena element syntax, convertible back to CQCode by
   * this encoder. No consumer needs a second, platform-shaped copy.
   */
  it("normalizes CQCode into one canonical content string and encodes it back", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    await body.connect();

    const received: IMMessageEvent[] = [];
    ctx.on("message-created", (event) => void received.push(event));

    await dispatchSession(body, {
      post_type: "message",
      message_type: "group",
      sub_type: "normal",
      message_id: 2,
      group_id: 67890,
      user_id: 11111,
      self_id: 12345,
      time: 1692000,
      message: [
        { type: "at", data: { qq: "12345" } },
        { type: "text", data: { text: " look at " } },
        { type: "image", data: { url: "https://example.invalid/a.png", file: "a.png" } },
      ],
      sender: { user_id: 11111, nickname: "User", sex: "unknown", age: 0 },
    });

    const event = received[0];
    expect(event.content).toContain(`<at id="12345"`);
    expect(event.content).toContain(" look at ");
    expect(event.content).toContain(`src="https://example.invalid/a.png"`);
    // `content` is derived from the same elements, so archiving the string alone loses nothing.
    expect(event.content).toBe(event.message.elements?.map((element) => element.toString()).join(""));

    // A tool sending that canonical string back reaches the platform as CQCode.
    await body.sendMessage(event.channelId, parse(`<at id="11111"/> on it`));
    expect(body.sentMessages.at(-1)?.content).toEqual([
      { type: "at", data: { qq: "11111", name: undefined } },
      { type: "text", data: { text: " on it" } },
    ]);
  });

  it("dispatches normal sends with canonical content and elements", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    await body.connect();
    const sent: IMSendEvent[] = [];
    ctx.on("send", (event) => void sent.push(event));

    const results = await body.createMessage(
      "67890",
      parse('hello <at id="11111"/><p>paragraph</p><a href="https://example.invalid">link</a><image src="https://example.invalid/a.png"/>'),
    );

    expect(body.sentMessages).toHaveLength(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).not.toBe("");
    expect(sent[0].content).toContain('<at id="11111"');
    expect(sent[0].content).toContain('src="https://example.invalid/a.png"');
    expect(sent[0].content).not.toContain(" qq=");
    expect(sent[0].content).toBe(sent[0].message.elements?.map((element) => element.toString()).join(""));
    expect(results[0]).toMatchObject({ id: "42", content: sent[0].content, elements: sent[0].message.elements });
  });

  it("dispatches one canonical forward send event", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    await body.connect();
    const sent: IMSendEvent[] = [];
    ctx.on("send", (event) => void sent.push(event));

    const results = await body.createMessage(
      "67890",
      parse('<figure><message userId="11111" username="User">hello <at id="12345"/></message><message id="99"/></figure>'),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain("<figure>");
    expect(sent[0].content).toContain("<message");
    expect(sent[0].content).toContain('<at id="12345"');
    expect(sent[0].content).toBe(sent[0].message.elements?.map((element) => element.toString()).join(""));
    expect(results[0]).toMatchObject({ id: "43", content: sent[0].content, elements: sent[0].message.elements });
  });

  it("dispatches file uploads with canonical file content", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    await body.connect();
    const sent: IMSendEvent[] = [];
    ctx.on("send", (event) => void sent.push(event));

    const results = await body.createMessage("67890", parse('<file src="https://example.invalid/report.txt" title="report.txt"/>'));
    expect(body.uploadedFiles).toEqual([{ target: "67890", file: "/tmp/downloaded-file", name: "report.txt" }]);
    expect(sent).toHaveLength(1);
    expect(sent[0].content).toContain('<file src="https://example.invalid/report.txt" title="report.txt"/>');
    expect(sent[0].content).toBe(sent[0].message.elements?.map((element) => element.toString()).join(""));
    expect(results[0]).toMatchObject({ id: "", content: sent[0].content, elements: sent[0].message.elements });
  });

  it("finds OneBot bodies by sid through NerveService", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockOneBotBody(ctx);
    ctx.nerve.register(body);
    expect(ctx.nerve.get("onebot:12345")).toBe(body);
  });
});
