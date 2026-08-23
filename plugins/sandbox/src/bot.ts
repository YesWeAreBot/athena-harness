import type { JsonValue, MessageSink, SandboxRequestPayload } from "@athena-ai/protocol";
import { Bot, Time, Universal } from "@satorijs/core";
import type { Context } from "cordis";

import { SandboxMessenger } from "./message";

export namespace SandboxBot {
  export interface Config {
    /** Virtual platform id — unique per browser sandbox instance. */
    platform: string;
    /** Id of the harness login inside the sandbox. */
    selfId: string;
    /** Display name of the harness login inside the sandbox. */
    selfName: string;
    /** Abstract transport for sending frames to the frontend. */
    sink: MessageSink;
    /**
     * Base url used to rewrite outgoing `file:` resources into something the
     * browser can actually load. Undefined when the file server is disabled.
     */
    fileBase?: string;
  }
}

interface Pending {
  settle: (data: JsonValue) => void;
  fail: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/** How long the browser has to answer a `sandbox/request` frame. */
export const REQUEST_TIMEOUT = Time.second * 5;

/**
 * A bot whose entire "platform" lives in a browser tab.
 *
 * Outgoing messages are pushed over the WebUI socket; every Satori read API is
 * proxied to the page as a `sandbox/request` frame and correlated back by nonce.
 */
class SandboxMessageEncoder extends SandboxMessenger {
  constructor(
    bot: Bot,
    channelId: string,
    referrer?: ConstructorParameters<NonNullable<typeof Bot.MessageEncoder>>[2],
    options?: ConstructorParameters<NonNullable<typeof Bot.MessageEncoder>>[3],
  ) {
    // SAFETY: Satori invokes this constructor only from SandboxBot.send(), so the Bot instance is the SandboxBot
    // that owns this encoder; the base static type is intentionally broader than the concrete messenger needs.
    super(bot as SandboxBot, channelId, referrer, options);
  }
}

export class SandboxBot extends Bot<SandboxBot.Config> {
  static inject = ["satori"];
  static MessageEncoder = SandboxMessageEncoder;
  hidden = true;

  private _pending = new Map<string, Pending>();

  constructor(ctx: Context, config: SandboxBot.Config) {
    super(ctx, config, "sandbox");
    // `Bot` seeds `platform` from the adapter name; the sandbox wants one
    // virtual platform per browser instance so sessions stay separated.
    this.platform = config.platform;
    this.user = { id: config.selfId, name: config.selfName };
    this.internal = {};
  }

  async connect() {
    // Nothing to dial — the socket is owned by the WebUI service.
    this.online();
  }

  async disconnect() {
    const error = new Error("sandbox bot disconnected");
    for (const pending of this._pending.values()) {
      clearTimeout(pending.timer);
      pending.fail(error);
    }
    this._pending.clear();
  }

  /** Resolve a pending `sandbox/request` with the payload echoed by the page. */
  settle(nonce: string, data: JsonValue): void {
    const pending = this._pending.get(nonce);
    if (!pending) return;
    this._pending.delete(nonce);
    clearTimeout(pending.timer);
    pending.settle(data);
  }

  async request<T>(method: string, payload: SandboxRequestPayload = {}): Promise<T> {
    const nonce = Math.random().toString(36).slice(2);
    const result = await new Promise<JsonValue>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pending.delete(nonce);
        reject(new Error(`sandbox request timed out: ${method}`));
      }, REQUEST_TIMEOUT);
      this._pending.set(nonce, { settle: resolve, fail: reject, timer });
      this.config.sink.send({ type: "sandbox/request", body: { method, data: payload, nonce } });
    });
    // SAFETY: T is chosen by the caller from the Satori method contract, and the browser returns that method's JSON result.
    return result as T;
  }

  // -- Direct Channel --

  async createDirectChannel(userId: string): Promise<Universal.Channel> {
    return { id: `@${userId}`, type: Universal.Channel.Type.DIRECT };
  }

  // -- Message --

  async getMessage(channelId: string, messageId: string) {
    return this.request<Universal.Message>("getMessage", { channelId, messageId });
  }

  async deleteMessage(channelId: string, messageId: string) {
    await this.request<void>("deleteMessage", { channelId, messageId });
  }

  // -- Channel --

  async getChannel(channelId: string, guildId?: string) {
    return this.request<Universal.Channel>("getChannel", { channelId, guildId });
  }

  async getChannelList(guildId: string) {
    return this.request<Universal.List<Universal.Channel>>("getChannelList", { guildId });
  }

  // -- Guild --

  async getGuild(guildId: string) {
    return this.request<Universal.Guild>("getGuild", { guildId });
  }

  async getGuildList() {
    return this.request<Universal.List<Universal.Guild>>("getGuildList");
  }

  // -- Guild Member --

  async getGuildMember(guildId: string, userId: string) {
    return this.request<Universal.GuildMember>("getGuildMember", { guildId, userId });
  }

  async getGuildMemberList(guildId: string) {
    return this.request<Universal.List<Universal.GuildMember>>("getGuildMemberList", { guildId });
  }
}

export default SandboxBot;
