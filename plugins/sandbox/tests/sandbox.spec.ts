import type { JsonObject, MessageSink, SandboxDispatchPayload, SandboxNerveHandle, SandboxRequestPayload } from "@athena-ai/protocol";
import { Satori, type Session, Universal } from "@satorijs/core";
import { Context, type Fiber } from "cordis";
import type { Dict } from "cosmokit";
import { describe, expect, it } from "vitest";

import SandboxHub, { SandboxBot, SELF_ID, SELF_NAME } from "../src/index";

const PLATFORM = "sandbox:test";
const LIFE_ID = "test-life";
const DELETE_PREFIX = "__delete:";

interface Frame {
  type: string;
  body?: JsonObject;
}

interface LifeListEntry {
  id: string;
  name: string;
  description?: string;
}

/** Read the `lives` array out of a `sandbox/life-list` frame. */
function livesOf(frame: Frame | undefined): LifeListEntry[] | undefined {
  const body = frame?.body;
  if (!body || !("lives" in body)) throw new Error("not a sandbox/life-list frame");
  // SAFETY: The Hub constructs `lives` entries with exactly this shape.
  return body.lives as LifeListEntry[];
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
  readonly listeners: Dict<(body?: JsonObject) => void> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);

  addEntry() {
    return {};
  }
}

/**
 * A stand-in for `@athena-ai/sandbox-nerve`.
 *
 * The Hub owns no Satori state, so exercising `SandboxBot` and
 * `SandboxMessenger` needs something on the far side of the Hub's routing
 * boundary. This mirrors what the real Nerve does — one bot per platform inside
 * its own Satori domain — without making this package depend on it.
 */
class TestNerve implements SandboxNerveHandle {
  readonly meta = { name: "TestLife", description: "A test" };

  /** Resolves the first time the Hub releases a platform. */
  readonly released: Promise<string>;
  private _resolveReleased: (platform: string) => void;

  private _handles: Dict<{ fiber: Fiber; bot: Promise<SandboxBot> }> = Object.create(null);

  constructor(private ctx: Context) {
    const { promise, resolve } = Promise.withResolvers<string>();
    this.released = promise;
    this._resolveReleased = resolve;
  }

  async dispatch(payload: SandboxDispatchPayload) {
    const { platform, user, channel, content, sink, quote } = payload;
    const bot = await this._ensureBot(platform, sink).bot;
    bot.config.sink = sink;

    if (content.startsWith(DELETE_PREFIX)) {
      const session = bot.session(createEvent(user, channel));
      session.type = "message-deleted";
      session.messageId = content.slice(DELETE_PREFIX.length);
      bot.dispatch(session);
      return;
    }

    const id = Math.random().toString(36).slice(2);
    sink.send({ type: "sandbox/message", body: { id, content, user, channel, platform, lifeId: LIFE_ID } });

    const session = bot.session(createEvent(user, channel));
    session.type = "message";
    session.content = content;
    session.messageId = id;
    if (quote) session.quote = { id: quote.id, content: quote.content };
    bot.dispatch(session);
  }
  async request(method: string, data: SandboxRequestPayload): Promise<JsonValue> {
    const platform = data.platform;
    if (!platform) throw new Error("sandbox request requires platform");
    const handle = this._handles[platform];
    if (!handle) return null;
    const bot = await handle.bot;
    if (method === "settle") {
      const nonce = data.nonce;
      if (!nonce) throw new Error("sandbox response requires nonce");
      bot.settle(nonce, data.data ?? null);
      return null;
    }
    return bot.request<JsonValue>(method, data);
  }

  async release({ platform }: { clientId: string; platform: string }) {
    const handle = this._handles[platform];
    if (!handle) return;
    delete this._handles[platform];
    await handle.fiber.dispose();
    this._resolveReleased(platform);
  }

  /** The bot for a platform, for assertions that poke at Satori directly. */
  bot(platform = PLATFORM): Promise<SandboxBot> {
    return this._handles[platform].bot;
  }

  private _ensureBot(platform: string, sink: MessageSink) {
    const existing = this._handles[platform];
    if (existing) return existing;
    const fiber = this.ctx.plugin(SandboxBot, { platform, selfId: SELF_ID, selfName: SELF_NAME, sink });
    const bot = (async () => {
      await fiber;
      const registered = this.ctx.satori.bots[`${platform}:${SELF_ID}`];
      if (!(registered instanceof SandboxBot)) throw new Error("sandbox bot was not registered");
      return registered;
    })();
    return (this._handles[platform] = { fiber, bot });
  }
}

function createEvent(userId: string, channelId: string): Partial<Universal.Event> {
  const isDirect = channelId === `@${userId}`;
  return {
    user: { id: userId, name: userId },
    channel: { id: channelId, type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT },
    guild: isDirect ? undefined : { id: channelId },
    timestamp: Date.now(),
  };
}

async function setup() {
  const ctx = new Context();
  const webui = new FakeWebUI();
  ctx.provide("webui");
  ctx.set("webui", webui);

  // The Hub is global: it needs webui and nothing else.
  await ctx.plugin(SandboxHub, { fileServer: { enabled: false } });

  // Mirrors the runtime arrangement: the persona group owns the satori isolate.
  const inner = ctx.isolate("satori").isolate("bots");
  await inner.plugin(Satori);

  const sessions: Session[] = [];
  inner.on("message", (session) => void sessions.push(session));
  inner.on("message-deleted", (session) => void sessions.push(session));

  const hub = ctx.get("sandbox")!;
  const nerve = new TestNerve(inner);
  const unregister = hub.register(LIFE_ID, nerve);

  const client = new FakeClient();
  webui.clients[client.id] = client;

  const invoke = (type: string, body: JsonObject) => {
    const listener = webui.listeners[type];
    if (!listener) throw new Error(`listener not registered: ${type}`);
    return listener.call(client, { lifeId: LIFE_ID, ...body });
  };

  return { ctx, inner, webui, client, sessions, invoke, hub, nerve, unregister };
}

async function sendFromBrowser(user: string, channel: string, content: string) {
  const harness = await setup();
  await harness.invoke("sandbox/send-message", { platform: PLATFORM, user, channel, content });
  return harness;
}

describe("sandbox plugin", () => {
  it("registers its socket listeners and reclaims them on dispose", async () => {
    const { webui, ctx } = await setup();
    expect(Object.keys(webui.listeners).sort()).toEqual(["sandbox/delete-message", "sandbox/response", "sandbox/send-message"]);

    await ctx.fiber.dispose();
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

  it("stamps the lifeId on every frame it forwards to the browser", async () => {
    const { client } = await sendFromBrowser("Alice", "@Alice", "hello");
    expect(client.last("sandbox/message")?.body?.lifeId).toBe(LIFE_ID);
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

  it("rejects frames naming a Life that has no nerve", async () => {
    const { invoke } = await setup();
    await expect(invoke("sandbox/send-message", { lifeId: "ghost", platform: PLATFORM, user: "Alice", channel: "@Alice", content: "hi" })).rejects.toThrow(
      /no Life registered as 'ghost'/,
    );
  });

  it("reuses one bot per platform and releases it when the client disconnects", async () => {
    const { inner, webui, client, invoke, ctx, nerve } = await setup();
    await invoke("sandbox/send-message", { platform: PLATFORM, user: "Alice", channel: "@Alice", content: "a" });
    await invoke("sandbox/send-message", { platform: PLATFORM, user: "Alice", channel: "@Alice", content: "b" });

    const satori = inner.get("satori")!;
    expect(satori.bots).toHaveLength(1);
    expect(satori.bots[0].status).toBe(Universal.Status.ONLINE);

    delete webui.clients[client.id];
    // SAFETY: The fake Client implements only Hub-used members; `never` bypasses WebUI's complete Client type.
    ctx.emit("webui/connection", client as never);

    await expect(nerve.released).resolves.toBe(PLATFORM);
    expect(satori.bots).toHaveLength(0);
  });
});

describe("SandboxMessenger", () => {
  it("pushes harness replies to the browser", async () => {
    const { nerve, client } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = await nerve.bot();

    const ids = await bot.sendMessage("@Alice", "hi there");

    const reply = client.last("sandbox/message");
    expect(reply?.body).toMatchObject({
      content: "hi there",
      user: SELF_NAME,
      channel: "@Alice",
      platform: PLATFORM,
    });
    expect(ids).toEqual([reply?.body?.id]);
  });

  it("splits a multi-message fragment into separate bubbles", async () => {
    const { nerve, client } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = await nerve.bot();

    await bot.sendMessage("@Alice", "<message>one</message><message>two</message>");

    const bubbles = client.frames.filter((frame) => frame.type === "sandbox/message");
    // one echo of the browser input plus one bubble per message element
    expect(bubbles.map((frame) => frame.body?.content)).toEqual(["hello", "one", "two"]);
  });
});

describe("SandboxBot.request", () => {
  it("correlates the browser's response by nonce", async () => {
    const { nerve, client, invoke } = await sendFromBrowser("Alice", "@Alice", "hello");
    const bot = await nerve.bot();

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

describe("SandboxHub service", () => {
  it("exposes the Hub contract on the sandbox service", async () => {
    const { hub } = await setup();
    expect(hub.register).toBeTypeOf("function");
    expect(hub.lives).toBeTypeOf("function");
  });

  it("reports a registered nerve in lives()", async () => {
    const { hub, unregister } = await setup();
    expect(hub.lives()).toEqual([{ id: LIFE_ID, meta: { name: "TestLife", description: "A test" } }]);
    unregister();
    expect(hub.lives()).toEqual([]);
  });

  it("throws on duplicate lifeId registration", async () => {
    const { hub, inner } = await setup();
    expect(() => hub.register(LIFE_ID, new TestNerve(inner))).toThrow(/already registered/);
  });

  it("broadcasts life-list to all clients on register and unregister", async () => {
    const { hub, inner, client, unregister } = await setup();

    client.frames.length = 0;
    const second = hub.register("other", new TestNerve(inner));

    expect(livesOf(client.last("sandbox/life-list"))).toEqual([
      { id: LIFE_ID, name: "TestLife", description: "A test" },
      { id: "other", name: "TestLife", description: "A test" },
    ]);

    second();
    unregister();
    expect(livesOf(client.last("sandbox/life-list"))).toEqual([]);
  });

  it("sends the life-list to a freshly connected client", async () => {
    const { ctx, webui } = await setup();
    const fresh = new FakeClient();
    webui.clients[fresh.id] = fresh;
    // SAFETY: The fake Client implements only Hub-used members; `never` bypasses WebUI's complete Client type.
    ctx.emit("webui/connection", fresh as never);

    expect(livesOf(fresh.last("sandbox/life-list"))).toEqual([{ id: LIFE_ID, name: "TestLife", description: "A test" }]);
  });

  it("routes send-message to the nerve named by lifeId", async () => {
    const { hub, invoke } = await setup();
    const dispatched: SandboxDispatchPayload[] = [];
    hub.register("router", {
      meta: { name: "Router" },
      async dispatch(payload) {
        dispatched.push(payload);
      },
      async request() {
        return null;
      },
      async release() {},
    });

    await invoke("sandbox/send-message", {
      lifeId: "router",
      platform: PLATFORM,
      user: "Alice",
      channel: "@Alice",
      content: "routed!",
    });

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0].content).toBe("routed!");
    expect(dispatched[0].sink).toBeDefined();
  });
});
