import type { Channel, Guild, GuildMember, List, Login, Message, User } from "@athena-ai/protocol-im";
import { IMBody } from "@athena-ai/protocol-im";
import type { Element } from "@cordisjs/element";
import type {} from "@cordisjs/plugin-http";
import { Context } from "cordis";
import Schema from "schemastery";

import { OneBotHttpServer } from "../http.js";
import type * as OneBot from "../types.js";
import { Internal } from "../types.js";
import { adaptChannel, adaptGuild, adaptMessage, decodeGuildMember, decodeUser, PRIVATE_PFX } from "../utils.js";
import { OneBotWsClient, OneBotWsServer } from "../ws.js";
import { OneBotMessageEncoder } from "./message.js";

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
    this.internal = new Internal(this);
    this.user = {
      id: config.selfId,
      avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${config.selfId}&spec=640`,
    };
  }

  async connect(): Promise<void> {
    this.status = "connecting";
    try {
      if (this.config.protocol === "ws") {
        const config = this.config as OneBotBody.BaseConfig & OneBotBody.WsClientOptions;
        this._wsClient = new OneBotWsClient(this.ctx, this, {
          retryTimes: config.retryTimes,
          retryInterval: config.retryInterval,
          retryLazy: config.retryLazy,
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

  // ─── Group Operations ──────────────────────────────────────────────────

  /**
   * OneBot models the owner/admin distinction as two fixed roles.
   * Mapping the role id back to the corresponding capability keeps the
   * abstract surface small while preserving the platform's semantics.
   */
  async checkPermission(name: string, session: { member?: GuildMember }): Promise<boolean> {
    if (name === "onebot.group.admin") {
      return session.member?.roles?.[0]?.id === "admin";
    }
    if (name === "onebot.group.owner") {
      return session.member?.roles?.[0]?.id === "owner";
    }
    return false;
  }

  async setGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    if (roleId !== "admin") {
      throw new Error(`Unsupported role: ${roleId}`);
    }
    await this.internal.setGroupAdmin(guildId, userId, true);
  }

  async unsetGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void> {
    if (roleId !== "admin") {
      throw new Error(`Unsupported role: ${roleId}`);
    }
    await this.internal.setGroupAdmin(guildId, userId, false);
  }
}

export namespace OneBotBody {
  export interface BaseConfig {
    selfId: string;
    token?: string;
    protocol: "ws" | "ws-reverse" | "http";
  }

  export interface HttpOptions {
    protocol: "http";
    endpoint?: string;
    path?: string;
    secret?: string;
    responseTimeout?: number;
  }

  export interface WsClientOptions {
    protocol: "ws";
    endpoint?: string;
    responseTimeout?: number;
    retryTimes: number;
    retryInterval: number;
    retryLazy: number;
  }

  export interface WsServerOptions {
    protocol: "ws-reverse";
    path?: string;
    responseTimeout: number;
  }

  export interface AdvancedConfig {
    splitMixedContent?: boolean;
  }

  export type Config = BaseConfig & (HttpOptions | WsClientOptions | WsServerOptions) & { advanced?: AdvancedConfig };

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    selfId: Schema.string().required().description("机器人的账号。"),
    token: Schema.string().role("secret").description("发送信息时用于验证的字段，应与 OneBot 配置文件中的 `access_token` 保持一致。"),
    protocol: Schema.union(["ws", "ws-reverse", "http"]).default("ws-reverse").description("选择要使用的协议。"),
  });

  export const HttpOptions: Schema<HttpOptions> = Schema.intersect([
    Schema.object({
      protocol: Schema.const("http").required(),
      endpoint: Schema.string().description("OneBot HTTP 端点 URL。"),
      path: Schema.string().description("服务器监听的路径。").default("/onebot"),
      secret: Schema.string().role("secret").description("接收事件推送时用于验证的字段，应该与 OneBot 的 secret 配置保持一致。"),
      responseTimeout: Schema.natural().default(15000).description("等待响应的时间 (单位为毫秒)。"),
    }).description("连接设置"),
  ]);

  export const WsClientOptions: Schema<WsClientOptions> = Schema.intersect([
    Schema.object({
      protocol: Schema.const("ws").required(),
      endpoint: Schema.string().description("WebSocket 端点 URL。"),
      responseTimeout: Schema.natural().default(15000).description("等待响应的时间 (单位为毫秒)。"),
    }).description("连接设置"),
    Schema.object({
      retryTimes: Schema.natural().default(6).description("初始连接时的最大重试次数。"),
      retryInterval: Schema.natural().default(5000).description("初始连接时的重试间隔 (单位为毫秒)。"),
      retryLazy: Schema.natural().default(60000).description("连接断开后的重试间隔 (单位为毫秒)。"),
    }).description("重连设置"),
  ]);

  export const WsServerOptions: Schema<WsServerOptions> = Schema.object({
    protocol: Schema.const("ws-reverse").required(),
    path: Schema.string().description("服务器监听的路径。").default("/onebot"),
    responseTimeout: Schema.natural().default(15000).description("等待响应的时间 (单位为毫秒)。"),
  }).description("连接设置");

  export const AdvancedConfig: Schema<AdvancedConfig> = Schema.object({
    splitMixedContent: Schema.boolean().description("是否自动在混合内容间插入空格。").default(true),
  }).description("高级设置");

  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    Schema.union([HttpOptions, WsClientOptions, WsServerOptions]),
    Schema.object({
      advanced: AdvancedConfig,
    }),
  ]);
}

// ─── BodyRegistry injection ──────────────────────────────────────────────────
// Enables `body.platform === "onebot"` narrowing on the AnyBody union.

declare module "@athena-ai/protocol" {
  interface BodyRegistry {
    onebot: OneBotBody;
  }
}
