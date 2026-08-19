import { Satori, Bot, Session } from "@satorijs/core";
import type { Fragment } from "@satorijs/element";
import type { Message, SendOptions } from "@satorijs/protocol";
import { Context, Service } from "cordis";
import type { Dict } from "cosmokit";
import Schema from "schemastery";

import type { MessageServiceConfig } from "./types";

export class MessageService extends Service<MessageServiceConfig> {
  static name = "message";
  static usage = `Message service for handling message operations`;
  // static Config: Schema<MessageServiceConfig> = Schema.object({
  //   adapters: Schema.array(Schema.object({
  //     name: Schema.string(),
  //     config: Schema.dict(Schema.string).role("table")
  //   }))
  // }) as Schema<MessageServiceConfig>

  public readonly config: MessageServiceConfig;

  private _inner: Context;

  constructor(ctx: Context, config: MessageServiceConfig) {
    super(ctx, "message");
    this.config = config;

    // Create isolation domain — satori and bots are invisible outside
    this._inner = ctx.isolate("satori").isolate("bots");

    // Install Satori inside isolation
    this._inner.plugin(Satori);

    // Inject [Context.filter] on all sessions for scope isolation
    const messageSymbol = ctx[Context.isolate]["message"] as symbol;
    this._inner.on("internal/session", (session: Session) => {
      session[Context.filter] = (hookCtx: Context) => {
        return hookCtx[Context.isolate]["message"] === messageSymbol;
      };
    });

    // Install configured adapters
    for (const adapter of config.adapters ?? []) {
      this._loadAdapter(adapter.name, adapter.config);
    }
  }

  /** Bots registry — proxy to internal Satori bots */
  get bots(): Bot[] & Dict<Bot> {
    return this._inner.get("satori")?.bots ?? ([] as unknown as Bot[] & Dict<Bot>);
  }

  /** Install an adapter into the isolation domain */
  adapter(plugin: (ctx: Context, config?: Record<string, unknown>) => void, config?: Record<string, unknown>): () => void {
    const fork = this._inner.plugin(plugin, config);
    return () => {
      fork.dispose();
    };
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

  private async _loadAdapter(name: string, config?: Record<string, unknown>) {
    try {
      // Dynamic import required: adapter name is a runtime-selected plugin specifier
      const mod = await import(name);
      const plugin = mod.default ?? mod;
      this._inner.plugin(plugin, config);
    } catch (e) {
      this.ctx.logger("message").error(`Failed to load adapter: ${name}`, e);
    }
  }
}
