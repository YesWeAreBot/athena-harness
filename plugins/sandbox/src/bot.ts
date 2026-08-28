import type { Session } from "@athena-ai/protocol";
import type { Guild, GuildMember, List, Message, User } from "@athena-ai/protocol-im";
import { Channel, IMBody } from "@athena-ai/protocol-im";
import { parse } from "@cordisjs/element";
import type { Context } from "cordis";

import { SandboxMessenger } from "./message.js";
import type { JsonValue, MessageSink, SandboxRequestPayload } from "./shared.js";

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
export const REQUEST_TIMEOUT = 5000;

/**
 * A body whose entire "platform" lives in a browser tab.
 *
 * Outgoing messages are pushed over the WebUI socket; every IM read API is
 * proxied to the page as a `sandbox/request` frame and correlated back by nonce.
 */
export class SandboxBot extends IMBody<SandboxBot.Config> {
  static inject = ["nerve"];

  public readonly platform: string;
  public user: User | undefined;

  private _pending = new Map<string, Pending>();

  constructor(ctx: Context, config: SandboxBot.Config) {
    super(ctx, config);
    this.platform = config.platform;
    this.selfId = config.selfId;
    this.user = { id: config.selfId, name: config.selfName };
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
    // SAFETY: T is chosen by the caller from the IM method contract, and the browser returns that method's JSON result.
    return result as T;
  }

  // -- Direct Channel --

  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: Channel.Type.DIRECT };
  }

  /**
   * The normalized `message-created` Session for text typed in the page.
   *
   * Every Nerve that drives this body builds the same event, and `elements`
   * belongs in it: `content` alone cannot answer `isAtSelf()`, so a Cortex that
   * routes on mentions would never see one typed in the sandbox.
   */
  receive(payload: { id: string; user: string; channel: string; content: string; quote?: { id: string; content: string } }): Session {
    const channel = this.channelOf(payload.channel, payload.user);
    const user: User = { id: payload.user, name: payload.user };
    const session = this.session({
      type: "message-created",
      user,
      channel,
      guild: channel.type === Channel.Type.DIRECT ? undefined : { id: payload.channel },
      message: { id: payload.id, content: payload.content, elements: parse(payload.content), user, channel },
    });
    if (payload.quote) session.quote = { id: payload.quote.id, content: payload.quote.content };
    return session;
  }

  /** Sandbox channels are direct when named after the user that owns them. */
  channelOf(channelId: string, userId?: string): Channel {
    const direct = userId === undefined ? channelId.startsWith("@") : channelId === `@${userId}`;
    return { id: channelId, type: direct ? Channel.Type.DIRECT : Channel.Type.TEXT };
  }

  // -- Message --

  async createMessage(channelId: string, content: import("@cordisjs/element").Fragment): Promise<Message[]> {
    const encoder = new SandboxMessenger(this, channelId);
    return encoder.send(content);
  }

  async getMessage(channelId: string, messageId: string) {
    return this.request<Message>("getMessage", { channelId, messageId });
  }

  async deleteMessage(channelId: string, messageId: string) {
    await this.request<void>("deleteMessage", { channelId, messageId });
  }

  // -- Channel --

  async getChannel(channelId: string, guildId?: string) {
    return this.request<Channel>("getChannel", { channelId, guildId });
  }

  async getChannelList(guildId: string) {
    return this.request<List<Channel>>("getChannelList", { guildId });
  }

  // -- Guild --

  async getGuild(guildId: string) {
    return this.request<Guild>("getGuild", { guildId });
  }

  async getGuildList() {
    return this.request<List<Guild>>("getGuildList");
  }

  // -- Guild Member --

  async getGuildMember(guildId: string, userId: string) {
    return this.request<GuildMember>("getGuildMember", { guildId, userId });
  }

  async getGuildMemberList(guildId: string) {
    return this.request<List<GuildMember>>("getGuildMemberList", { guildId });
  }
}

export default SandboxBot;
