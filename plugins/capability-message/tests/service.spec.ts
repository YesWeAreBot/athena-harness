import { Bot, type Session, Universal } from "@satorijs/core";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import MessageService from "../src/index.js";

/** Build the arrangement the runtime uses: the group owns the isolation. */
function createDomain() {
  const ctx = new Context();
  const inner = ctx.isolate("satori").isolate("bots");
  return { ctx, inner };
}

/** A minimal real `Bot`, so `session.bot.ctx` reflects a genuine domain. */
class StubBot extends Bot<{ platform: string }> {
  static reusable = true;
  static inject = ["satori"];

  constructor(ctx: Context, config: { platform: string }) {
    super(ctx, config, "stub");
    this.platform = config.platform;
    this.selfId = "self";
    this.user = { id: "self", name: "self" };
  }

  async connect() {
    this.online();
  }
}

/**
 * Install a bot in `domain` and let it dispatch one message, returning the
 * session every `internal/session` listener saw.
 */
async function dispatch(domain: Context, platform: string): Promise<Session> {
  await domain.plugin(StubBot, { platform });
  const bot = domain.satori.bots[`${platform}:self`];
  const session = bot.session({
    user: { id: "u1", name: "u1" },
    channel: { id: "@u1", type: Universal.Channel.Type.DIRECT },
    timestamp: Date.now(),
  });
  session.type = "message";
  session.content = "hello";
  session.messageId = "m1";
  bot.dispatch(session);
  return session;
}

describe("MessageService", () => {
  it("provides ctx.message when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    expect(ctx.message).toBeInstanceOf(MessageService);
  });

  it("group isolation hides satori outside while message stays visible", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    expect(ctx.get("satori")).toBeUndefined();
    expect(ctx.get("message")).toBeInstanceOf(MessageService);
  });

  it("bots returns empty array initially", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    expect(ctx.message.bots).toHaveLength(0);
  });

  it("bots resolves through the captured ctx when reached from outside", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    // SAFETY: this object has Bot's prototype and the fields consumed by MessageService.
    const fakeBot = Object.create(Bot.prototype, {
      sid: { value: "fake:1" },
      isActive: { value: true },
    }) as Bot;
    inner.get("satori")!.bots.push(fakeBot);
    // ctx.get() rebinds this.ctx on the traceable proxy, and the caller's ctx
    // cannot resolve `satori` — the service must use its own captured ctx
    expect(ctx.get("message")!.bots).toHaveLength(1);
  });

  it("_resolveBot throws when no bots", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    await expect(ctx.message.sendMessage("ch1", "hello")).rejects.toThrow("No active bots available");
  });

  it("a sibling plugin in the same isolate domain registers its bot", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    // SAFETY: this object has Bot's prototype and the fields consumed by MessageService.
    const fakeBot = Object.create(Bot.prototype, {
      sid: { value: "fake:1" },
      isActive: { value: true },
    }) as Bot;
    function fakeAdapter(adapterCtx: Context) {
      // Sibling entries resolve the capability's satori through the group isolate
      adapterCtx.satori.bots.push(fakeBot);
    }
    fakeAdapter.inject = ["satori"];
    await inner.plugin(fakeAdapter);

    expect(ctx.message.bots).toHaveLength(1);
    expect(ctx.message.bots[0].sid).toBe("fake:1");
  });

  it("claims a session dispatched by a bot in its own satori domain", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    const session = await dispatch(inner, "own");

    const filter = session[Context.filter];
    expect(filter).toBeTypeOf("function");
    expect(filter!.call(session, ctx)).toBe(true);
    expect(filter!.call(session, ctx.isolate("message"))).toBe(false);
  });

  it("ignores a session dispatched by a bot from another satori domain", async () => {
    const root = new Context();
    const alice = root.isolate("satori").isolate("bots").isolate("message");
    const bob = root.isolate("satori").isolate("bots").isolate("message");
    await alice.plugin(MessageService, {});
    await bob.plugin(MessageService, {});

    const session = await dispatch(alice, "alice");
    const filter = session[Context.filter];
    expect(filter).toBeTypeOf("function");
    expect(filter!.call(session, alice)).toBe(true);
    expect(filter!.call(session, bob)).toBe(false);
  });
});
