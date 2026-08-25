import { IMBody } from "@athena-ai/protocol-im";
import type { Channel, Guild, GuildMember, List, Login, Message, User } from "@athena-ai/protocol-im";
import type { Element } from "@cordisjs/element";
import type {} from "@cordisjs/plugin-http";
import { Context, Service } from "cordis";
import Schema from "schemastery";

import { adaptChannel, adaptGuild, adaptMessage, decodeGuildMember, decodeUser, PRIVATE_PFX } from "./adapter.js";
import { OneBotMessageEncoder } from "./encoder.js";
import { OneBotHttpServer } from "./http.js";
import { Internal } from "./types.js";
import type * as OneBot from "./types.js";
import { OneBotWsClient, OneBotWsServer } from "./ws.js";

export class OneBotBody extends IMBody<OneBotBody.Config> {
  static inject = ["nerve", "http"];
  static reusable = true;

  public readonly platform = "onebot";
  public internal: Internal;
  public user: User | undefined;

  private _wsClient?: OneBotWsClient;

  constructor(ctx: Context, config: OneBotBody.Config) {
    super(ctx, config);
    this.selfId = config.selfId;
    this.internal = new Internal(config.selfId);
    this.user = {
      id: config.selfId,
      avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${config.selfId}&spec=640`,
    };
  }

  *[Service.init]() {
    // SAFETY: the base implementation registers into ctx.nerve and starts the connection.
    yield* super[Service.init]();
  }

  async connect(): Promise<void> {
    this.status = "connecting";
    try {
      if (this.config.protocol === "ws") {
        this._wsClient = new OneBotWsClient(this.ctx, this, {
          retryTimes: this.config.retryTimes,
          retryInterval: this.config.retryInterval,
          retryLazy: this.config.retryLazy,
        });
        this._wsClient.start();
      } else if (this.config.protocol === "ws-reverse") {
        new OneBotWsServer(this.ctx, this);
      } else if (this.config.protocol === "http") {
        const httpServer = new OneBotHttpServer(this.ctx, this);
        await httpServer.connect();
      }
    } catch (error) {
      this.offline();
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    await this._wsClient?.stop();
    this._wsClient = undefined;
  }

  /** Called after connection is established to fetch login info. */
  async initialize(): Promise<void> {
    try {
      const info = await this.internal.getLoginInfo();
      this.user = decodeUser(info);
      this.online();
    } catch (error) {
      this.offline();
      this.ctx.logger("onebot").warn("Failed to fetch login info:", error);
    }
  }

  // ─── Message ────────────────────────────────────────────────────────────

  async createMessage(channelId: string, content: Element[]): Promise<Message[]> {
    const encoder = new OneBotMessageEncoder(this, channelId);
    return encoder.send(content);
  }

  async sendMessage(channelId: string, content: Element[]): Promise<string[]> {
    const messages = await this.createMessage(channelId, content);
    return messages.map((m) => m.id).filter((id): id is string => !!id);
  }

  async sendPrivateMessage(userId: string, content: Element[], guildId?: string): Promise<string[]> {
    const channel = await this.createDirectChannel(userId, guildId);
    return this.sendMessage(channel.id, content);
  }

  async getMessage(_channelId: string, messageId: string): Promise<Message> {
    const data = await this.internal.getMsg(messageId);
    return adaptMessage(this, data);
  }

  async getMessageList(channelId: string, next?: string, direction: "before" | "after" = "before"): Promise<List<Message>> {
    if (direction !== "before") throw new Error("Unsupported direction.");

    let list: OneBot.Message[] = [];
    if (channelId.startsWith(PRIVATE_PFX)) {
      const userId = channelId.slice(PRIVATE_PFX.length);
      if (next) {
        const msg = await this.internal.getMsg(next);
        if (msg?.message_seq) {
          list = await this.internal.getFriendMsgHistory(userId, msg.message_seq);
        }
      } else {
        list = await this.internal.getFriendMsgHistory(userId);
      }
    } else {
      if (next) {
        const msg = await this.internal.getMsg(next);
        if (msg?.message_seq) {
          list = (await this.internal.getGroupMsgHistory(Number(channelId), msg.message_seq)).messages;
        }
      } else {
        list = (await this.internal.getGroupMsgHistory(Number(channelId))).messages;
      }
    }

    return { data: await Promise.all(list.map((data) => adaptMessage(this, data))) };
  }

  async editMessage(_channelId: string, _messageId: string, _content: Element[]): Promise<void> {
    throw new Error("OneBot does not support message editing.");
  }

  async deleteMessage(_channelId: string, messageId: string): Promise<void> {
    await this.internal.deleteMsg(messageId);
  }

  // ─── Reaction ───────────────────────────────────────────────────────────

  async createReaction(_channelId: string, messageId: string, emojiId: string): Promise<void> {
    await this.internal.setMsgEmojiLike(messageId, emojiId, true);
  }

  async deleteReaction(_channelId: string, messageId: string, emojiId: string, _userId?: string): Promise<void> {
    await this.internal.setMsgEmojiLike(messageId, emojiId, false);
  }

  // ─── User / Login ──────────────────────────────────────────────────────

  async getLogin(): Promise<Login> {
    const info = await this.internal.getLoginInfo();
    this.user = decodeUser(info);
    return { user: this.user, platform: this.platform, status: 1, features: [] };
  }

  async getUser(userId: string): Promise<User> {
    const info = await this.internal.getStrangerInfo(userId);
    return decodeUser(info);
  }

  async getFriendList(): Promise<List<User>> {
    const data = await this.internal.getFriendList();
    return { data: data.map(decodeUser) };
  }

  async deleteFriend(userId: string): Promise<void> {
    await this.internal.deleteFriend(userId);
  }

  async createDirectChannel(userId: string, _guildId?: string): Promise<Channel> {
    return { id: `${PRIVATE_PFX}${userId}`, type: 1 };
  }

  // ─── Guild (Group) ─────────────────────────────────────────────────────

  async getGuild(guildId: string): Promise<Guild> {
    const info = await this.internal.getGroupInfo(guildId);
    return adaptGuild(info);
  }

  async getGuildList(): Promise<List<Guild>> {
    const data = await this.internal.getGroupList();
    return { data: data.map(adaptGuild) };
  }

  async getGuildMember(guildId: string, userId: string): Promise<GuildMember> {
    const info = await this.internal.getGroupMemberInfo(guildId, userId);
    return decodeGuildMember(info);
  }

  async getGuildMemberList(guildId: string): Promise<List<GuildMember>> {
    const data = await this.internal.getGroupMemberList(guildId);
    return { data: data.map(decodeGuildMember) };
  }

  async kickGuildMember(guildId: string, userId: string, permanent?: boolean): Promise<void> {
    await this.internal.setGroupKick(guildId, userId, permanent);
  }

  async muteGuildMember(guildId: string, userId: string, duration: number): Promise<void> {
    await this.internal.setGroupBan(guildId, userId, Math.round(duration / 1000));
  }

  async muteChannel(channelId: string, _guildId?: string, enable?: boolean): Promise<void> {
    await this.internal.setGroupWholeBan(channelId, enable);
  }

  // ─── Channel ───────────────────────────────────────────────────────────

  async getChannel(channelId: string): Promise<Channel> {
    if (channelId.startsWith(PRIVATE_PFX)) {
      return { id: channelId, type: 1, name: channelId.slice(PRIVATE_PFX.length) };
    }
    const info = await this.internal.getGroupInfo(channelId);
    return adaptChannel(info);
  }

  async getChannelList(guildId: string): Promise<List<Channel>> {
    return { data: [await this.getChannel(guildId)] };
  }

  // ─── Request Handling ──────────────────────────────────────────────────

  async handleFriendRequest(messageId: string, approve: boolean, comment?: string): Promise<void> {
    await this.internal.setFriendAddRequest(messageId, approve, comment);
  }

  async handleGuildRequest(messageId: string, approve: boolean, comment?: string): Promise<void> {
    await this.internal.setGroupAddRequest(messageId, "invite", approve, comment);
  }

  async handleGuildMemberRequest(messageId: string, approve: boolean, comment?: string): Promise<void> {
    await this.internal.setGroupAddRequest(messageId, "add", approve, comment);
  }
}

export namespace OneBotBody {
  export interface Config {
    protocol: "ws" | "ws-reverse" | "http";
    selfId: string;
    endpoint?: string;
    token?: string;
    secret?: string;
    path?: string;
    responseTimeout: number;
    retryTimes: number;
    retryInterval: number;
    retryLazy: number;
  }

  const schema = Schema.intersect([
    Schema.object({
      protocol: Schema.union(["ws", "ws-reverse", "http"]).default("ws").description("Connection protocol."),
      selfId: Schema.string().required().description("Bot QQ number."),
      endpoint: Schema.string().description("WebSocket or HTTP endpoint URL."),
      token: Schema.string().role("secret").description("Access token for authentication."),
      secret: Schema.string().role("secret").description("Secret for HTTP webhook signature verification."),
      path: Schema.string().description("Path for ws-reverse or http webhook.").default("/onebot"),
      responseTimeout: Schema.natural().default(15000).description("Timeout for API responses (ms)."),
    }).description("Basic Settings"),
    Schema.object({
      retryTimes: Schema.natural().default(6).description("Max retry attempts on initial connection."),
      retryInterval: Schema.natural().default(5000).description("Retry interval on initial connection (ms)."),
      retryLazy: Schema.natural().default(60000).description("Retry interval after connection drops (ms)."),
    }).description("Reconnection Settings"),
  ]);
  // SAFETY: the schema covers exactly the Config fields, so the narrowed type is accurate.
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion -- SAFETY comment is above; rule misses assertions on exported declarations
  export const Config: Schema<Config> = schema as Schema<Config>;
}
