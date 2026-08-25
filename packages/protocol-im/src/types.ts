import type { Element } from "@cordisjs/element";

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface List<T = any> {
  data: T[];
  next?: string;
}

export interface BidiList<T = any> extends List<T> {
  prev?: string;
}

export type Direction = "before" | "after" | "around";
export type Order = "asc" | "desc";

// ─── Send Options ───────────────────────────────────────────────────────────

export interface SendOptions {
  linkPreview?: boolean;
}

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name?: string;
  nick?: string;
  avatar?: string;
  isBot?: boolean;
}

// ─── Channel ────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  type: Channel.Type;
  name?: string;
  parentId?: string;
}

export namespace Channel {
  export const enum Type {
    TEXT = 0,
    DIRECT = 1,
    CATEGORY = 2,
    VOICE = 3,
  }
}

// ─── Guild ──────────────────────────────────────────────────────────────────

export interface Guild {
  id: string;
  name?: string;
  avatar?: string;
}

// ─── Guild Role ─────────────────────────────────────────────────────────────

export interface GuildRole {
  id: string;
  name?: string;
  color?: number;
  position?: number;
}

// ─── Guild Member ───────────────────────────────────────────────────────────

export interface GuildMember {
  user?: User;
  name?: string;
  nick?: string;
  avatar?: string;
  roles?: GuildRole[];
  joinedAt?: number;
}

// ─── Friend ─────────────────────────────────────────────────────────────────

export interface Friend {
  user?: User;
  nick?: string;
}

// ─── Message ────────────────────────────────────────────────────────────────

export interface Message {
  id?: string;
  channel?: Channel;
  guild?: Guild;
  user?: User;
  member?: GuildMember;
  content?: string;
  elements?: Element[];
  timestamp?: number;
  quote?: Message;
  createdAt?: number;
  updatedAt?: number;
}

// ─── Login ──────────────────────────────────────────────────────────────────

export interface Login {
  user?: User;
  platform?: string;
  status: LoginStatus;
  features: string[];
}

export const enum LoginStatus {
  OFFLINE = 0,
  ONLINE = 1,
  CONNECT = 2,
  DISCONNECT = 3,
  RECONNECT = 4,
}

// ─── Methods 表（数据驱动，单一事实来源）────────────────────────────────────

export interface Method {
  name: string;
  fields: Field[];
  isForm: boolean;
}

export interface Field {
  name: string;
}

export function Field(name: string): Field {
  return { name };
}

export function Method(name: string, fields: string[], isForm = false): Method {
  return { name, fields: fields.map(Field), isForm };
}

/**
 * Data-driven registry of IM methods.
 * The single source of truth for method names, parameter order and
 * wire-level parameter names. `Body` implementations provide a subset;
 * the protocol layer derives types and capability checks from this table.
 */
export const Methods = {
  // message
  "message.create": Method("createMessage", ["channel_id", "content"]),
  "message.send": Method("sendMessage", ["channel_id", "content"]),
  "message.sendPrivate": Method("sendPrivateMessage", ["user_id", "content", "guild_id"]),
  "message.get": Method("getMessage", ["channel_id", "message_id"]),
  "message.list": Method("getMessageList", ["channel_id", "next", "direction", "limit", "order"]),
  "message.edit": Method("editMessage", ["channel_id", "message_id", "content"]),
  "message.delete": Method("deleteMessage", ["channel_id", "message_id"]),

  // reaction
  "reaction.create": Method("createReaction", ["channel_id", "message_id", "emoji_id"]),
  "reaction.delete": Method("deleteReaction", ["channel_id", "message_id", "emoji_id", "user_id"]),
  "reaction.clear": Method("clearReaction", ["channel_id", "message_id", "emoji_id"]),
  "reaction.list": Method("getReactionList", ["channel_id", "message_id", "emoji_id", "next"]),

  // user / login
  "login.get": Method("getLogin", []),
  "user.get": Method("getUser", ["user_id", "guild_id"]),
  "user.channel.create": Method("createDirectChannel", ["user_id", "guild_id"]),
  "friend.list": Method("getFriendList", ["next"]),
  "friend.delete": Method("deleteFriend", ["user_id"]),

  // guild
  "guild.get": Method("getGuild", ["guild_id"]),
  "guild.list": Method("getGuildList", ["next"]),

  // guild member
  "guild.member.get": Method("getGuildMember", ["guild_id", "user_id"]),
  "guild.member.list": Method("getGuildMemberList", ["guild_id", "next"]),
  "guild.member.kick": Method("kickGuildMember", ["guild_id", "user_id", "permanent"]),
  "guild.member.mute": Method("muteGuildMember", ["guild_id", "user_id", "duration", "reason"]),
  "guild.member.role.set": Method("setGuildMemberRole", ["guild_id", "user_id", "role_id"]),
  "guild.member.role.unset": Method("unsetGuildMemberRole", ["guild_id", "user_id", "role_id"]),

  // guild role
  "guild.role.list": Method("getGuildRoleList", ["guild_id", "next"]),
  "guild.role.create": Method("createGuildRole", ["guild_id", "data"]),
  "guild.role.update": Method("updateGuildRole", ["guild_id", "role_id", "data"]),
  "guild.role.delete": Method("deleteGuildRole", ["guild_id", "role_id"]),

  // channel
  "channel.get": Method("getChannel", ["channel_id", "guild_id"]),
  "channel.list": Method("getChannelList", ["guild_id", "next"]),
  "channel.create": Method("createChannel", ["guild_id", "data"]),
  "channel.update": Method("updateChannel", ["channel_id", "data"]),
  "channel.delete": Method("deleteChannel", ["channel_id"]),
  "channel.mute": Method("muteChannel", ["channel_id", "guild_id", "enable"]),

  // request handling
  "friend.approve": Method("handleFriendRequest", ["message_id", "approve", "comment"]),
  "guild.approve": Method("handleGuildRequest", ["message_id", "approve", "comment"]),
  "guild.member.approve": Method("handleGuildMemberRequest", ["message_id", "approve", "comment"]),
} satisfies Record<string, Method>;
