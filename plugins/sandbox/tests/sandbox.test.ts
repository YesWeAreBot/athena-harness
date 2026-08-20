import { Satori, type Session, Universal } from "@satorijs/core";
import { Context } from "cordis";
import type { Dict } from "cosmokit";
import { describe, expect, it } from "vitest";

import * as sandbox from "../src/index";

const PLATFORM = "sandbox:test";

interface Frame {
  type: string;
  body?: Record<string, unknown>;
}

/** Stands in for a browser tab holding a WebUI socket. */
class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];

  send(payload: Frame) {
    this.frames.push(payload);
  }

  /** The last frame of a given type, which is what assertions care about. */
  last(type: string): Frame | undefined {
    return this.frames.filter((frame) => frame.type === type).at(-1);
  }
}

/** The slice of `WebUI` the sandbox plugin actually touches. */
class FakeWebUI {
  readonly listeners: Dict<(body?: unknown) => unknown> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);

  addEntry() {
    return {};
  }
}

async function setup() {
  const ctx = new Context();
  const webui = new FakeWebUI();
  ctx.provide("webui");
  ctx.set("webui", webui);

  // Mirrors the runtime arrangement: the persona group owns the satori isolate.
  const inner = ctx.isolate("satori").isolate("bots");
  await inner.plugin(Satori);

  const sessions: Session[] = [];
  inner.on("message", (session) => void sessions.push(session));
  inner.on("message-deleted", (session) => void sessions.push(session));

  await inner.plugin(sandbox, { fileServer: { enabled: false } });

  const client = new FakeClient();
  webui.clients[client.id] = client;

  const invoke = (type: string, body: unknown) => {
    const listener = webui.listeners[type];
    if (!listener) throw new Error(`listener not registered: ${type}`);
    return Reflect.apply(listener, client, [body]);
  };

  return { ctx, inner, webui, client, sessions, invoke };
}

async function sendFromBrowser(user: string, channel: string, content: string) {
  const harness = await setup();
  await harness.invoke("sandbox/send-message", { platform: PLATFORM, user, channel, content });
  return harness;
}

describe("sandbox plugin", () => {
  it("registers its socket listeners and reclaims them on dispose", async () => {
    const { webui, inner } = await setup();
    expect(Object.keys(webui.listeners).sort()).toEqual(["sandbox/delete-message", "sandbox/response", "sandbox/send-message"]);

    await inner.fiber.dispose();
    expect(Object.keys(webui.listeners)).toEqual([]);
  });

  it("echoes browser input back as a bubble and dispatches a session", async () => {
    const { client, sessions } = await sendFromBrowser("Alice", "@Alice", "hello");

    const echo = client.last("sandbox/message");
    expect(echo?.body).toMatchObject({ content: "hello", user: "Alice", channel: "@Alice", platform: PLATFORM });

    expect(sessions).toHaveLength(1);
    expect(sessions[0].type).toBe("message-created");
    expect(sessions[0].content).toBe("hello");
    expect(sessions[0].userId).toBe("Alice");
    expect(sessions[0].isDirect).toBe(true);
    expect(sessions[0].messageId).toBe(echo?.body?.id);
  });

  it("treats a guild channel as a non-direct session", async () => {
    const { sessions } = await sendFromBrowser("Alice", "#", "hello");
    expect(sessions[0].isDirect).toBe(false);
    expect(sessions[0].guildId).toBe("#");
  });

  it("keeps the quote instead of letting the content setter drop it", async () => {
    const { invoke, sessions } = await setup();
    await invoke("sandbox/send-message", {
      platform: PLATFORM,
      user: "Alice",
      channel: "@Alice",
      content: "hello",
      quote: { id: "q1", content: "earlier", user: "Alice", channel: "@Alice", platform: PLATFORM },
    });
    expect(sessions[0].quote).toEqual({ id: "q1", content: "earlier" });
    expect(sessions[0].content).toBe("hello");
  });

  it("dispatches message-deleted when the browser retracts a bubble", async () => {
    const { invoke, sessions } = await setup();
    await invoke("sandbox/delete-message", {
      platform: PLATFORM,
      user: "Alice",
      channel: "@Alice",
      messageId: "m1",
    });
    expect(sessions).toHaveLength(1);
    expect(sessions[0].type).toBe("message-deleted");
    expect(sessions[0].messageId).toBe("m1");
  });

  it("reuses one bot per platform and drops it when the client disconnects", async () => {
    const { inner, webui, client, invoke } = await setup();
    await invoke("sandbox/send-message", { platform: PLATFORM, user: "Alice", channel: "@Alice", content: "a" });
    await invoke("sandbox/send-message", { platform: PLATFORM, user: "Alice", channel: "@Alice", content: "b" });

    const satori = inner.get("satori")!;
    expect(satori.bots).toHaveLength(1);
    expect(satori.bots[0].status).toBe(Universal.Status.ONLINE);

    delete webui.clients[client.id];
    inner.emit("webui/connection", client as never);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(satori.bots).toHaveLength(0);
  });
});

describe("SandboxMessenger", () => {
  it("pushes harness replies to the browser", async () => {
    const { inner, client } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = inner.get("satori")!.bots[0];

    const ids = await bot.sendMessage("@Alice", "hi there");

    const reply = client.last("sandbox/message");
    expect(reply?.body).toMatchObject({
      content: "hi there",
      user: sandbox.SELF_NAME,
      channel: "@Alice",
      platform: PLATFORM,
    });
    expect(ids).toEqual([reply?.body?.id]);
  });

  it("splits a multi-message fragment into separate bubbles", async () => {
    const { inner, client } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = inner.get("satori")!.bots[0];

    await bot.sendMessage("@Alice", "<message>one</message><message>two</message>");

    const bubbles = client.frames.filter((frame) => frame.type === "sandbox/message");
    // one echo of the browser input plus one bubble per message element
    expect(bubbles.map((frame) => frame.body?.content)).toEqual(["hello", "one", "two"]);
  });
});

describe("SandboxBot.request", () => {
  it("correlates the browser's response by nonce", async () => {
    const { inner, client, invoke } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = inner.get("satori")!.bots[0];

    const pending = bot.getChannel("@Alice");
    const request = client.last("sandbox/request");
    expect(request?.body).toMatchObject({ method: "getChannel", data: { channelId: "@Alice" } });

    await invoke("sandbox/response", {
      platform: PLATFORM,
      nonce: request?.body?.nonce,
      data: { id: "@Alice", type: Universal.Channel.Type.DIRECT },
    });

    await expect(pending).resolves.toEqual({ id: "@Alice", type: Universal.Channel.Type.DIRECT });
  });

  it("ignores a response whose nonce is unknown", async () => {
    const { invoke } = await sendFromBrowser("Alice", "@Alice", "hello");
    await expect(invoke("sandbox/response", { platform: PLATFORM, nonce: "nope", data: 1 })).resolves.toBeUndefined();
  });
});
