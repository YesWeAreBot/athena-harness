import type { Session } from "@athena-ai/protocol";

import type { IMSession } from "./session.js";
import type { Channel, Guild, GuildMember, GuildRole, Login, Message, User } from "./types.js";

// ─── Base IM Event ──────────────────────────────────────────────────────────

/** Common fields shared by all IM events. */
export interface IMEvent extends IMSession {
  /** Channel where the event occurred (narrowed from the accessor). */
  channelId: string;
  /** User who triggered the event (narrowed from the accessor). */
  userId: string;
}

// ─── Message Events ─────────────────────────────────────────────────────────

export interface IMMessageEvent extends IMEvent {
  type: "message-created";
  messageId: string;
  message: Message;
}

export interface IMMessageDeletedEvent extends IMEvent {
  type: "message-deleted";
  messageId: string;
}

export interface IMMessageUpdatedEvent extends IMEvent {
  type: "message-updated";
  messageId: string;
  message: Message;
}

// ─── Send Event (outgoing) ──────────────────────────────────────────────────

export interface IMSendEvent extends IMEvent {
  type: "send";
  messageId: string;
  message: Message;
}

// ─── Guild Events ───────────────────────────────────────────────────────────

export interface IMGuildEvent extends IMEvent {
  type: "guild-added" | "guild-removed" | "guild-updated";
}

export interface IMGuildMemberEvent extends IMEvent {
  type: "guild-member-added" | "guild-member-removed" | "guild-member-updated";
}

export interface IMGuildRoleEvent extends IMEvent {
  type: "guild-role-created" | "guild-role-deleted" | "guild-role-updated";
  role?: GuildRole;
}

// ─── Login Events ───────────────────────────────────────────────────────────

export interface IMLoginEvent extends Session {
  type: "login-added" | "login-removed" | "login-updated";
  login: Login;
}

// ─── Request Events ─────────────────────────────────────────────────────────

export interface IMRequestEvent extends IMEvent {
  type: "friend-request" | "guild-request" | "guild-member-request";
  messageId: string;
}

// ─── Friend Events ──────────────────────────────────────────────────────────

export interface IMFriendEvent extends IMEvent {
  type: "friend-added";
}

// ─── Reaction Events ────────────────────────────────────────────────────────

export interface IMReactionEvent extends IMEvent {
  type: "reaction-added" | "reaction-removed";
  messageId: string;
  emoji?: { id: string; name?: string };
}

// ─── Internal/Platform-specific Events ──────────────────────────────────────

export interface IMInternalEvent extends Session {
  type: "internal";
  _type: string;
  _data: unknown;
}

// ─── Event Data Extension ───────────────────────────────────────────────────
// The base `Event` payload carries no IM semantics. protocol-im extends it
// with optional entity references; the IMSession accessors derive the flat
// views (`channelId`, `userId`, `content`, ...) from these nested objects.

declare module "@athena-ai/protocol" {
  interface Event {
    channel?: Channel;
    guild?: Guild;
    user?: User;
    member?: GuildMember;
    message?: Message;
    quote?: Message;
    subtype?: string;
    /** For internal/platform-specific events. */
    _type?: string;
    _data?: unknown;
  }
}

// ─── Cordis Events Registration ─────────────────────────────────────────────
// Single source of truth for IM event signatures (satori pattern):
// only `cordis.Events` is declared; there is no parallel event map.

declare module "cordis" {
  interface Events {
    "message-created"(event: IMMessageEvent): void;
    "message-deleted"(event: IMMessageDeletedEvent): void;
    "message-updated"(event: IMMessageUpdatedEvent): void;
    send(event: IMSendEvent): void;
    "guild-added"(event: IMGuildEvent): void;
    "guild-removed"(event: IMGuildEvent): void;
    "guild-updated"(event: IMGuildEvent): void;
    "guild-member-added"(event: IMGuildMemberEvent): void;
    "guild-member-removed"(event: IMGuildMemberEvent): void;
    "guild-member-updated"(event: IMGuildMemberEvent): void;
    "guild-role-created"(event: IMGuildRoleEvent): void;
    "guild-role-deleted"(event: IMGuildRoleEvent): void;
    "guild-role-updated"(event: IMGuildRoleEvent): void;
    "login-added"(event: IMLoginEvent): void;
    "login-removed"(event: IMLoginEvent): void;
    "login-updated"(event: IMLoginEvent): void;
    "friend-request"(event: IMRequestEvent): void;
    "guild-request"(event: IMRequestEvent): void;
    "guild-member-request"(event: IMRequestEvent): void;
    "friend-added"(event: IMFriendEvent): void;
    "reaction-added"(event: IMReactionEvent): void;
    "reaction-removed"(event: IMReactionEvent): void;
    internal(event: IMInternalEvent): void;
  }
}
