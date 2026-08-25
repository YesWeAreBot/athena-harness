import { SandboxBot, SELF_ID } from "@athena-ai/plugin-sandbox";
import type { MessageSink, SandboxDispatchPayload, SandboxRequestPayload } from "@athena-ai/protocol";
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
 * without their Nerve domains colliding.
 */
export default class SandboxNerve {
  public static readonly name = "sandbox-nerve";
  public static readonly inject = ["sandbox", "nerve", "life"];

  private _handles: Record<string, BotHandle> = Object.create(null);
  private _lifeId: string;

  constructor(private ctx: Context) {
    this._lifeId = ctx.life.id ?? "life";

    const unregister = ctx.sandbox.register(this._lifeId, {
      meta: {
        name: ctx.life.id ?? "Life",
        description: undefined,
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
      const event = bot.session({ type: "message-deleted", message: { id: content.slice(DELETE_PREFIX.length) } });
      bot.dispatch(event);
      return;
    }

    const id = Math.random().toString(36).slice(2);

    // Echo the user's own message back so the page renders it immediately.
    sink.send({
      type: "sandbox/message",
      body: { id, content, user, channel, platform, lifeId: this._lifeId },
    });

    const event = bot.session({
      type: "message-created",
      user: { id: user, name: user },
      channel: { id: channel, type: channel === `@${user}` ? 1 : 0 },
      guild: channel === `@${user}` ? undefined : { id: channel },
      message: { id, content, user: { id: user, name: user }, channel: { id: channel, type: channel === `@${user}` ? 1 : 0 } },
    });
    if (payload.quote) {
      event.quote = { id: payload.quote.id, content: payload.quote.content };
    }
    bot.dispatch(event);
  }

  private async _request(method: string, payload: SandboxRequestPayload): Promise<unknown> {
    const platform = payload.platform;
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
      // SAFETY: The Hub only sends settle frames with a nonce; the bot ignores unknown nonces.
      bot.settle(payload.nonce as string, payload.data ?? null);
      return null;
    }

    return bot.request<unknown>(method, payload);
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

  /** Ensure a `SandboxBot` exists for `platform` in this Life's Nerve domain. */
  private _ensureBot(platform: string, sink: MessageSink): BotHandle {
    const existing = this._handles[platform];
    if (existing) return existing;

    const ctx = this.ctx;
    const fiber = ctx.plugin(SandboxBot, {
      platform,
      selfId: SELF_ID,
      selfName: ctx.life.id ?? "Life",
      sink,
      fileBase: ctx.sandbox.fileBase,
    });

    const bot = (async () => {
      await fiber;
      const registered = ctx.nerve.get(`${platform}:${SELF_ID}`);
      if (!registered) throw new Error(`sandbox-nerve: bot was not registered for platform ${platform}`);
      if (!(registered instanceof SandboxBot)) {
        throw new Error(`sandbox-nerve: registered bot has unexpected type for platform ${platform}`);
      }
      return registered;
    })();

    return (this._handles[platform] = { fiber, bot });
  }
}

/** Marker the Hub uses to tunnel retractions through `dispatch`. */
const DELETE_PREFIX = "__delete:";
