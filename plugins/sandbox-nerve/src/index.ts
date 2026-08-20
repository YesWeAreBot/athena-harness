import { SandboxBot, SELF_ID } from "@athena-ai/plugin-sandbox";
import type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "@athena-ai/protocol";
import { Dict, Universal } from "@satorijs/core";
import type { Context, Fiber } from "cordis";

interface BotHandle {
  fiber: Fiber;
  bot: Promise<SandboxBot>;
}

/**
 * Sandbox Nerve: the per-Life half of the sandbox plugin.
 *
 * Lives inside a Life's isolated group and owns the `SandboxBot` instances for
 * that Life. It registers itself with the global `sandbox` Hub, which routes
 * browser frames here by `lifeId`, so one sandbox page can drive many Lives
 * without their Satori domains colliding.
 */
export default class SandboxNerve {
  public static readonly name = "sandbox-nerve";
  public static readonly inject = ["sandbox", "satori", "life"];

  private _handles: Dict<BotHandle> = Object.create(null);
  private _lifeId: string;

  constructor(private ctx: Context) {
    this._lifeId = ctx.life.persona.name.toLowerCase();

    const unregister = (ctx.sandbox as SandboxHubService).register(this._lifeId, {
      meta: {
        name: ctx.life.persona.name,
        description: ctx.life.persona.description,
      },
      dispatch: (payload) => this._dispatch(payload),
      request: (method, data) => this._request(method, data),
      release: (payload) => this._release(payload.platform),
    });

    ctx.effect(() => {
      return () => {
        unregister();
        for (const handle of Object.values(this._handles)) {
          handle.fiber.dispose();
        }
        this._handles = Object.create(null);
      };
    }, "sandbox-nerve.cleanup");
  }

  // ---------------------------------------------------------------------------
  // SandboxNerveHandle implementation
  // ---------------------------------------------------------------------------

  private async _dispatch(payload: SandboxDispatchPayload): Promise<void> {
    const { platform, user, channel, content, sink } = payload;
    const bot = await this._ensureBot(platform, sink).bot;

    // One bot serves a platform across reconnects; point it at the tab that is
    // talking to us right now so replies never go to a closed socket.
    bot.config.sink = sink;

    // The Hub encodes retractions as a pseudo-content marker so that the wire
    // protocol only needs a single `dispatch` entry point.
    if (content.startsWith(DELETE_PREFIX)) {
      const session = bot.session(this._createEvent(user, channel));
      session.type = "message-deleted";
      session.messageId = content.slice(DELETE_PREFIX.length);
      bot.dispatch(session);
      return;
    }

    const id = Math.random().toString(36).slice(2);

    // Echo the user's own message back so the page renders it immediately.
    sink.send({
      type: "sandbox/message",
      body: { id, content, user, channel, platform, lifeId: this._lifeId },
    });

    const session = bot.session(this._createEvent(user, channel));
    session.type = "message";
    session.content = content;
    session.messageId = id;
    if (payload.quote) {
      session.quote = { id: payload.quote.id, content: payload.quote.content };
    }
    bot.dispatch(session);
  }

  private async _request(method: string, data: Record<string, unknown>): Promise<unknown> {
    const platform = data.platform as string | undefined;
    if (!platform) throw new Error("sandbox-nerve: request requires `platform` in data");
    const handle = this._handles[platform];
    if (!handle) {
      // A response can arrive after the bot was torn down; drop it silently.
      if (method === "settle") return null;
      throw new Error(`sandbox-nerve: no bot for platform ${platform}`);
    }
    const bot = await handle.bot;

    // Response correlation coming back from the browser.
    if (method === "settle") {
      bot.settle(data.nonce as string, data.data);
      return null;
    }

    return bot.request(method, data);
  }

  /** Tear down the bot backing a browser tab that has gone away. */
  private async _release(platform: string): Promise<void> {
    const handle = this._handles[platform];
    if (!handle) return;
    delete this._handles[platform];
    await handle.fiber.dispose();
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /** Ensure a `SandboxBot` exists for `platform` in this Life's Satori domain. */
  private _ensureBot(platform: string, sink: MessageSink): BotHandle {
    const existing = this._handles[platform];
    if (existing) return existing;

    const ctx = this.ctx;
    const fiber = ctx.plugin(SandboxBot, {
      platform,
      selfId: SELF_ID,
      selfName: ctx.life.persona.name,
      sink,
      fileBase: (ctx.sandbox as SandboxHubService).fileBase,
    });

    const bot = (async () => {
      await fiber;
      const registered = ctx.satori.bots[`${platform}:${SELF_ID}`];
      if (!registered) throw new Error(`sandbox-nerve: bot was not registered for platform ${platform}`);
      return registered as SandboxBot;
    })();

    return (this._handles[platform] = { fiber, bot });
  }

  private _createEvent(userId: string, channelId: string): Partial<Universal.Event> {
    const isDirect = channelId === "@" + userId;
    return {
      user: { id: userId, name: userId },
      channel: {
        id: channelId,
        type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
      },
      guild: isDirect ? undefined : { id: channelId },
      timestamp: Date.now(),
    };
  }
}

/** Marker the Hub uses to tunnel retractions through `dispatch`. */
const DELETE_PREFIX = "__delete:";

export type { SandboxNerveHandle };
