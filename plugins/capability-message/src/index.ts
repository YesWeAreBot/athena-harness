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

    // Inject [Context.filter] on all sessions for scope isolation
    const messageSymbol = ctx[Context.isolate]["message"] as symbol;
    ctx.on("internal/session", (session: Session) => {
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
