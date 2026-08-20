import { Bot, MessageEncoder, Session, Universal, WsClientConfig } from "@satorijs/core";
import { Context } from "cordis";
import Schema from "schemastery";

import type { OneBotHttpServer } from "./http";
import { OneBotMessageEncoder, PRIVATE_PFX } from "./message";
import * as OneBot from "./types";
import { adaptChannel, adaptGuild, adaptMessage, decodeGuildMember, decodeUser, dispatchSession } from "./utils";
import type { OneBotWsClient } from "./ws";

export class OneBotBot<T extends OneBotBot.Config = OneBotBot.Config> extends Bot<T> {
  static inject = ["satori", "http"];
  static schema = true as const;
  static MessageEncoder = OneBotMessageEncoder as unknown as new (
    bot: Bot,
    channelId: string,
    referrer?: unknown,
    options?: Universal.SendOptions,
  ) => MessageEncoder;

  declare public internal: OneBot.Internal;

  private _wsClient?: OneBotWsClient;
  private _httpServer?: OneBotHttpServer;

  constructor(ctx: Context, config: T) {
    super(ctx, config, "onebot");
    this.selfId = config.selfId;
    this.internal = new OneBot.Internal(this);
    this.user = { id: config.selfId } as Universal.User;
    this.user!.avatar = `http://q.qlogo.cn/headimg_dl?dst_uin=${config.selfId}&spec=640`;
  }

  async connect() {
    if (this.config.protocol === "ws") {
      const { OneBotWsClient: WsClient } = await import("./ws");
      this._wsClient = new WsClient(this.ctx, this);
      await this._wsClient.start();
    } else if (this.config.protocol === "ws-reverse") {
      const { OneBotWsServer } = await import("./ws");
      new OneBotWsServer(this.ctx, this);
    } else if (this.config.protocol === "http") {
      const { OneBotHttpServer: HttpServer } = await import("./http");
      this._httpServer = new HttpServer(this.ctx, this);
      await this._httpServer.connect();
    }
  }

  async disconnect() {
    await this._wsClient?.stop();
  }

  async initialize() {
    try {
      await this.getLogin();
      this.online();
    } catch (error) {
      this.offline(error as Error);
    }
  }

  // -- Direct Channel --

  async createDirectChannel(userId: string) {
    return { id: `${PRIVATE_PFX}${userId}`, type: Universal.Channel.Type.DIRECT } as Universal.Channel;
  }

  // -- Message --

  async getMessage(channelId: string, messageId: string) {
    const data = await this.internal.getMsg(messageId);
    return await adaptMessage(this, data);
  }

  async deleteMessage(channelId: string, messageId: string) {
    await this.internal.deleteMsg(messageId);
  }

  async getMessageList(channelId: string, next?: string, direction: Universal.Direction = "before") {
    if (direction !== "before") throw new Error("Unsupported direction.");
    let list: OneBot.Message[] = [];

    if (channelId.startsWith("private:")) {
      const userId = channelId.slice("private:".length);
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

    return { data: await Promise.all(list.map((item) => adaptMessage(this, item))) };
  }

  // -- Login / User --

  override async getLogin() {
    const data = await this.internal.getLoginInfo();
    this.user = decodeUser(data);
    return this.toJSON();
  }

  async getUser(userId: string) {
    const data = await this.internal.getStrangerInfo(userId);
    return decodeUser(data);
  }

  async getFriendList() {
    const data = await this.internal.getFriendList();
    return { data: data.map(decodeUser) };
  }

  // -- Request handling --

  async handleFriendRequest(messageId: string, approve: boolean, comment?: string) {
    await this.internal.setFriendAddRequest(messageId, approve, comment);
  }

  async handleGuildRequest(messageId: string, approve: boolean, comment?: string) {
    await this.internal.setGroupAddRequest(messageId, "invite", approve, comment);
  }

  async handleGuildMemberRequest(messageId: string, approve: boolean, comment?: string) {
    await this.internal.setGroupAddRequest(messageId, "add", approve, comment);
  }

  async deleteFriend(userId: string) {
    await this.internal.deleteFriend(userId);
  }

  // -- Guild (Group) --

  async getChannel(channelId: string) {
    if (channelId.startsWith("private:")) {
      const userId = channelId.slice("private:".length);
      return {
        id: channelId,
        type: Universal.Channel.Type.DIRECT,
        name: userId,
      } satisfies Universal.Channel;
    }
    const data = await this.internal.getGroupInfo(channelId);
    return adaptChannel(data);
  }

  async getGuild(guildId: string) {
    const data = await this.internal.getGroupInfo(guildId);
    return adaptGuild(data);
  }

  async getGuildList() {
    const data = await this.internal.getGroupList();
    return { data: data.map(adaptGuild) };
  }

  async getChannelList(guildId: string) {
    return { data: [await this.getChannel(guildId)] };
  }

  async getGuildMember(guildId: string, userId: string) {
    const data = await this.internal.getGroupMemberInfo(guildId, userId);
    return decodeGuildMember(data);
  }

  async getGuildMemberList(guildId: string) {
    const data = await this.internal.getGroupMemberList(guildId);
    return { data: data.map(decodeGuildMember) };
  }

  async kickGuildMember(guildId: string, userId: string, permanent?: boolean) {
    return this.internal.setGroupKick(guildId, userId, permanent);
  }

  async muteGuildMember(guildId: string, userId: string, duration: number) {
    return this.internal.setGroupBan(guildId, userId, Math.round(duration / 1000));
  }

  async muteChannel(channelId: string, guildId?: string, enable?: boolean) {
    return this.internal.setGroupWholeBan(channelId, enable);
  }

  // -- Reaction --

  async createReaction(channelId: string, messageId: string, emojiId: string) {
    return this.internal.setMsgEmojiLike(messageId, emojiId, true);
  }

  async deleteReaction(channelId: string, messageId: string, emojiId: string, userId?: string) {
    return this.internal.setMsgEmojiLike(messageId, emojiId, false);
  }

  // -- Permission --

  override async checkPermission(name: string, session: Partial<Session>) {
    if (name === "onebot.group.admin") {
      return session.author?.roles?.[0]?.id === "admin";
    } else if (name === "onebot.group.owner") {
      return session.author?.roles?.[0]?.id === "owner";
    }
    return super.checkPermission(name, session);
  }
}

export namespace OneBotBot {
  export interface BaseConfig {
    selfId: string;
    token?: string;
  }

  export const BaseConfig: Schema<BaseConfig> = Schema.object({
    selfId: Schema.string().description("机器人的账号。").required(),
    token: Schema.string().role("secret").description("发送信息时用于验证的字段，应与 OneBot 的 access_token 保持一致。"),
    protocol: Schema.union(["http", "ws", "ws-reverse"]).description("选择要使用的协议。").default("ws-reverse"),
  });

  export interface WsOptions extends WsClientConfig {
    protocol: "ws";
    endpoint?: string;
    responseTimeout?: number;
  }

  export const WsOptions: Schema<WsOptions> = Schema.intersect([
    Schema.object({
      protocol: Schema.const("ws").required(),
      endpoint: Schema.string().role("link").description("要连接的服务器地址。").default("ws://127.0.0.1:6700"),
      responseTimeout: Schema.natural().role("ms").description("等待响应的时间。").default(60000),
    }).description("连接设置"),
    WsClientConfig,
  ]);

  export interface WsReverseOptions {
    protocol: "ws-reverse";
    path?: string;
    responseTimeout?: number;
  }

  export const WsReverseOptions: Schema<WsReverseOptions> = Schema.object({
    protocol: Schema.const("ws-reverse").required(),
    path: Schema.string().description("服务器监听的路径。").default("/onebot"),
    responseTimeout: Schema.natural().role("ms").description("等待响应的时间。").default(60000),
  }).description("连接设置");

  export interface HttpOptions {
    protocol: "http";
    endpoint?: string;
    path?: string;
    secret?: string;
  }

  export const HttpOptions: Schema<HttpOptions> = Schema.object({
    protocol: Schema.const("http").required(),
    endpoint: Schema.string().role("link").description("要连接的服务器地址。"),
    path: Schema.string().description("服务器监听的路径。").default("/onebot"),
    secret: Schema.string().description("接收事件推送时用于验证的字段。").role("secret"),
  }).description("连接设置");

  export interface AdvancedConfig {
    splitMixedContent?: boolean;
  }

  export const AdvancedConfig: Schema<AdvancedConfig> = Schema.object({
    splitMixedContent: Schema.boolean().description("是否自动在混合内容间插入空格。").default(true),
  }).description("高级设置");

  /** Flat config type for internal use — all protocol-specific fields optional */
  export interface Config extends WsClientConfig {
    protocol: "ws" | "ws-reverse" | "http";
    selfId: string;
    token?: string;
    endpoint?: string;
    path?: string;
    secret?: string;
    responseTimeout?: number;
    advanced?: AdvancedConfig;
  }

  /** Schema uses intersect + union for protocol-discriminated UI */
  export const Config: Schema<Config> = Schema.intersect([
    BaseConfig,
    Schema.union([HttpOptions, WsOptions, WsReverseOptions]),
    Schema.object({
      advanced: AdvancedConfig,
    }),
  ]) as Schema<Config>;
}

export { dispatchSession };
