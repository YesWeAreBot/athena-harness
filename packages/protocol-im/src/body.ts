import { Body } from "@athena-ai/protocol";
import type { Event } from "@athena-ai/protocol";
import type { Fragment } from "@cordisjs/element";

import { IMSession } from "./session.js";
import type { BidiList, Channel, Direction, Friend, Guild, GuildMember, GuildRole, List, Login, Message, Order, SendOptions, User } from "./types.js";

/**
 * Base class for IM platform connections.
 *
 * Provides default implementations for every method in `Methods`:
 * - composite methods (sendMessage → createMessage, sendPrivateMessage → createDirectChannel + sendMessage)
 *   are implemented in terms of primitives;
 * - everything else falls back to `_notImplemented`, so a missing capability
 *   fails loudly instead of surfacing as `TypeError: ... is not a function`.
 *
 * Adapters extend this and override the methods they support.
 * Parameters of default implementations are intentionally unnamed (`_` prefix):
 * they exist only to keep the protocol signature, matching by position.
 */
export abstract class IMBody<C = unknown> extends Body<C> {
  /** Create an IM Session envelope with accessor-derived views. */
  session(event: Partial<Event> = {}): IMSession {
    return new IMSession(this, event);
  }

  // ─── Message ────────────────────────────────────────────────────────────

  async createMessage(_channelId: string, _content: Fragment, _options?: SendOptions): Promise<Message[]> {
    return this._notImplemented("createMessage");
  }

  async sendMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<string[]> {
    const messages = await this.createMessage(channelId, content, options);
    return messages.map((message) => message.id).filter((id): id is string => !!id);
  }

  async sendPrivateMessage(userId: string, content: Fragment, guildId?: string, options?: SendOptions): Promise<string[]> {
    const { id } = await this.createDirectChannel(userId, guildId);
    return this.sendMessage(id, content, options);
  }

  async getMessage(_channelId: string, _messageId: string): Promise<Message> {
    return this._notImplemented("getMessage");
  }

  async getMessageList(_channelId: string, _next?: string, _direction?: Direction, _limit?: number, _order?: Order): Promise<BidiList<Message>> {
    return this._notImplemented("getMessageList");
  }

  async editMessage(_channelId: string, _messageId: string, _content: Fragment): Promise<void> {
    return this._notImplemented("editMessage");
  }

  async deleteMessage(_channelId: string, _messageId: string): Promise<void> {
    return this._notImplemented("deleteMessage");
  }

  // ─── Reaction ───────────────────────────────────────────────────────────

  async createReaction(_channelId: string, _messageId: string, _emojiId: string): Promise<void> {
    return this._notImplemented("createReaction");
  }

  async deleteReaction(_channelId: string, _messageId: string, _emojiId: string, _userId?: string): Promise<void> {
    return this._notImplemented("deleteReaction");
  }

  async clearReaction(_channelId: string, _messageId: string, _emojiId?: string): Promise<void> {
    return this._notImplemented("clearReaction");
  }

  async getReactionList(_channelId: string, _messageId: string, _emojiId: string, _next?: string): Promise<List<User>> {
    return this._notImplemented("getReactionList");
  }

  // ─── User / Login ──────────────────────────────────────────────────────

  async getLogin(): Promise<Login> {
    return this._notImplemented("getLogin");
  }

  async getUser(_userId: string, _guildId?: string): Promise<User> {
    return this._notImplemented("getUser");
  }

  async getFriendList(_next?: string): Promise<List<Friend>> {
    return this._notImplemented("getFriendList");
  }

  async deleteFriend(_userId: string): Promise<void> {
    return this._notImplemented("deleteFriend");
  }

  async createDirectChannel(_userId: string, _guildId?: string): Promise<Channel> {
    return this._notImplemented("createDirectChannel");
  }

  // ─── Guild ─────────────────────────────────────────────────────────────

  async getGuild(_guildId: string): Promise<Guild> {
    return this._notImplemented("getGuild");
  }

  async getGuildList(_next?: string): Promise<List<Guild>> {
    return this._notImplemented("getGuildList");
  }

  // ─── Guild Member ──────────────────────────────────────────────────────

  async getGuildMember(_guildId: string, _userId: string): Promise<GuildMember> {
    return this._notImplemented("getGuildMember");
  }

  async getGuildMemberList(_guildId: string, _next?: string): Promise<List<GuildMember>> {
    return this._notImplemented("getGuildMemberList");
  }

  async kickGuildMember(_guildId: string, _userId: string, _permanent?: boolean): Promise<void> {
    return this._notImplemented("kickGuildMember");
  }

  async muteGuildMember(_guildId: string, _userId: string, _duration: number, _reason?: string): Promise<void> {
    return this._notImplemented("muteGuildMember");
  }

  async setGuildMemberRole(_guildId: string, _userId: string, _roleId: string): Promise<void> {
    return this._notImplemented("setGuildMemberRole");
  }

  async unsetGuildMemberRole(_guildId: string, _userId: string, _roleId: string): Promise<void> {
    return this._notImplemented("unsetGuildMemberRole");
  }

  // ─── Guild Role ────────────────────────────────────────────────────────

  async getGuildRoleList(_guildId: string, _next?: string): Promise<List<GuildRole>> {
    return this._notImplemented("getGuildRoleList");
  }

  async createGuildRole(_guildId: string, _data: Partial<GuildRole>): Promise<GuildRole> {
    return this._notImplemented("createGuildRole");
  }

  async updateGuildRole(_guildId: string, _roleId: string, _data: Partial<GuildRole>): Promise<void> {
    return this._notImplemented("updateGuildRole");
  }

  async deleteGuildRole(_guildId: string, _roleId: string): Promise<void> {
    return this._notImplemented("deleteGuildRole");
  }

  // ─── Channel ───────────────────────────────────────────────────────────

  async getChannel(_channelId: string, _guildId?: string): Promise<Channel> {
    return this._notImplemented("getChannel");
  }

  async getChannelList(_guildId: string, _next?: string): Promise<List<Channel>> {
    return this._notImplemented("getChannelList");
  }

  async createChannel(_guildId: string, _data: Partial<Channel>): Promise<Channel> {
    return this._notImplemented("createChannel");
  }

  async updateChannel(_channelId: string, _data: Partial<Channel>): Promise<void> {
    return this._notImplemented("updateChannel");
  }

  async deleteChannel(_channelId: string): Promise<void> {
    return this._notImplemented("deleteChannel");
  }

  async muteChannel(_channelId: string, _guildId?: string, _enable?: boolean): Promise<void> {
    return this._notImplemented("muteChannel");
  }

  // ─── Request Handling ──────────────────────────────────────────────────

  async handleFriendRequest(_messageId: string, _approve: boolean, _comment?: string): Promise<void> {
    return this._notImplemented("handleFriendRequest");
  }

  async handleGuildRequest(_messageId: string, _approve: boolean, _comment?: string): Promise<void> {
    return this._notImplemented("handleGuildRequest");
  }

  async handleGuildMemberRequest(_messageId: string, _approve: boolean, _comment?: string): Promise<void> {
    return this._notImplemented("handleGuildMemberRequest");
  }
}

/**
 * Declare the IM method set on the Nerve `Body` interface so that
 * `ctx.nerve.get(...)` and Cortex code see the full typed API.
 */
declare module "@athena-ai/protocol" {
  interface Body {
    createMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<Message[]>;
    sendMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<string[]>;
    sendPrivateMessage(userId: string, content: Fragment, guildId?: string, options?: SendOptions): Promise<string[]>;
    getMessage(channelId: string, messageId: string): Promise<Message>;
    getMessageList(channelId: string, next?: string, direction?: Direction, limit?: number, order?: Order): Promise<BidiList<Message>>;
    editMessage(channelId: string, messageId: string, content: Fragment): Promise<void>;
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    createReaction(channelId: string, messageId: string, emojiId: string): Promise<void>;
    deleteReaction(channelId: string, messageId: string, emojiId: string, userId?: string): Promise<void>;
    clearReaction(channelId: string, messageId: string, emojiId?: string): Promise<void>;
    getReactionList(channelId: string, messageId: string, emojiId: string, next?: string): Promise<List<User>>;
    getLogin(): Promise<Login>;
    getUser(userId: string, guildId?: string): Promise<User>;
    getFriendList(next?: string): Promise<List<Friend>>;
    deleteFriend(userId: string): Promise<void>;
    createDirectChannel(userId: string, guildId?: string): Promise<Channel>;
    getGuild(guildId: string): Promise<Guild>;
    getGuildList(next?: string): Promise<List<Guild>>;
    getGuildMember(guildId: string, userId: string): Promise<GuildMember>;
    getGuildMemberList(guildId: string, next?: string): Promise<List<GuildMember>>;
    kickGuildMember(guildId: string, userId: string, permanent?: boolean): Promise<void>;
    muteGuildMember(guildId: string, userId: string, duration: number, reason?: string): Promise<void>;
    setGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
    unsetGuildMemberRole(guildId: string, userId: string, roleId: string): Promise<void>;
    getGuildRoleList(guildId: string, next?: string): Promise<List<GuildRole>>;
    createGuildRole(guildId: string, data: Partial<GuildRole>): Promise<GuildRole>;
    updateGuildRole(guildId: string, roleId: string, data: Partial<GuildRole>): Promise<void>;
    deleteGuildRole(guildId: string, roleId: string): Promise<void>;
    getChannel(channelId: string, guildId?: string): Promise<Channel>;
    getChannelList(guildId: string, next?: string): Promise<List<Channel>>;
    createChannel(guildId: string, data: Partial<Channel>): Promise<Channel>;
    updateChannel(channelId: string, data: Partial<Channel>): Promise<void>;
    deleteChannel(channelId: string): Promise<void>;
    muteChannel(channelId: string, guildId?: string, enable?: boolean): Promise<void>;
    handleFriendRequest(messageId: string, approve: boolean, comment?: string): Promise<void>;
    handleGuildRequest(messageId: string, approve: boolean, comment?: string): Promise<void>;
    handleGuildMemberRequest(messageId: string, approve: boolean, comment?: string): Promise<void>;
  }
}
