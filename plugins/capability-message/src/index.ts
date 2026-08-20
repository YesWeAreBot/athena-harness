import { Satori, Bot, Session } from "@satorijs/core";
import type { Fragment } from "@satorijs/element";
import type { Message, SendOptions } from "@satorijs/protocol";
import { Context, Service } from "cordis";
import type { Dict } from "cosmokit";
import z from "schemastery";

declare module "cordis" {
  interface Context {
    message: MessageService;
  }
}

/**
 * Cordis wraps values passed through event hooks in traced proxies so that
 * `.ctx` follows the receiver. `Symbol.for("cordis.original")` is the proxy's
 * escape hatch back to the underlying object.
 */
const ORIGINAL = Symbol.for("cordis.original");

/** Unwrap a cordis traced proxy, returning the object itself if untraced. */
function unwrap<T extends object>(value: T | undefined): T | undefined {
  if (!value) return value;
  return ((value as Dict)[ORIGINAL as unknown as string] as T) ?? value;
}

export interface Config {}

export default class MessageService extends Service<Config> {
  public static readonly Config: z<Config> = z.object({});

  /**
   * The context this service was constructed with.
   *
   * Cordis rebinds `this.ctx` to the caller's context when the service is
   * reached through a traceable proxy (e.g. `ctx.get("message")` from root),
   * and that context may not resolve the `satori` isolate. Keep our own
   * reference so `bots` always looks in the right registry.
   */
  private _self: Context;

  constructor(ctx: Context) {
    super(ctx, "message");
    this._self = ctx;

    // Install Satori on our own context — isolation is declared by the
    // enclosing group entry so that sibling adapters share this domain.
    ctx.plugin(Satori);

    // Every `Session` dispatched by Satori is broadcast on the *global*
    // `internal/session` bus, so every MessageService in the process sees it.
    // Each instance must decide whether the session belongs to its own domain
    // and, if so, restrict delivery to hooks in the matching `message` isolate.
    //
    // The session handed to a hook is a cordis *traced proxy*: `Session` and
    // `Bot` both declare `[Service.tracker] = { property: "ctx" }`, which makes
    // `session.bot.ctx` resolve to the *receiving* context rather than the
    // context that owns the bot. Comparing against it would make every
    // instance claim every session (last writer wins). Unwrap to the original
    // object first so we read the bot's real context.
    const messageSymbol = ctx[Context.isolate]["message"] as symbol;
    const satoriSymbol = ctx[Context.isolate]["satori"] as symbol;
    ctx.on("internal/session", (session: Session) => {
      const bot = unwrap(session.bot);
      if (!bot || bot.ctx[Context.isolate]["satori"] !== satoriSymbol) return;
      session[Context.filter] = (hookCtx: Context) => {
        return hookCtx[Context.isolate]["message"] === messageSymbol;
      };
    });
  }

  /** Bots registry — proxy to the Satori bots of this isolation domain */
  get bots(): Bot[] & Dict<Bot> {
    return this._self.get("satori")?.bots ?? ([] as unknown as Bot[] & Dict<Bot>);
  }

  /** Send a message (creates message objects) */
  async createMessage(channelId: string, content: Fragment, botSid?: string, options?: SendOptions): Promise<Message[]> {
    const bot = this._resolveBot(botSid);
    return bot.createMessage(channelId, content, undefined, options);
  }

  /** Send and return message IDs */
  async sendMessage(channelId: string, content: Fragment, botSid?: string, options?: SendOptions): Promise<string[]> {
    const bot = this._resolveBot(botSid);
    return bot.sendMessage(channelId, content, undefined, options);
  }

  /** Send private message */
  async sendPrivateMessage(userId: string, content: Fragment, guildId?: string, botSid?: string, options?: SendOptions): Promise<string[]> {
    const bot = this._resolveBot(botSid);
    return bot.sendPrivateMessage(userId, content, guildId, options);
  }

  private _resolveBot(sid?: string): Bot {
    if (sid) {
      // The Satori bots proxy supports string-indexed lookup by sid
      const bot = this.bots.find((b) => b.sid === sid);
      if (!bot) throw new Error(`Bot not found: ${sid}`);
      return bot;
    }
    const active = this.bots.filter((b) => b.isActive);
    if (active.length === 0) throw new Error("No active bots available");
    if (active.length === 1) return active[0];
    throw new Error(`Multiple bots available (${active.map((b) => b.sid).join(", ")}); specify botSid`);
  }
}
