import type { Session } from "@athena-ai/protocol";

import type { IMBody } from "./body.js";
import type { Channel, GuildRole, Login, Message, User } from "./types.js";

// ─── Base IM Event ──────────────────────────────────────────────────────────

/**
 * Common fields shared by all IM events.
 * Uses intersection to narrow optional Session fields to required without
 * conflicting with the class-interface merge on Session.
 */
export type IMEvent = Session & {
  /** Channel where the event occurred (narrowed from the accessor). */
  channelId: string;
  /** User who triggered the event (narrowed from the accessor). */
  userId: string;
  /** Narrow the optional entity fields for IM events. */
  channel: Channel;
  user: User;
  /** The IM body that received this event. */
  body: IMBody;
};

// ─── Message Events ─────────────────────────────────────────────────────────

export type IMMessageEvent = IMEvent & {
  type: "message-created";
  messageId: string;
  message: Message;
  content: string;
};

export type IMMessageDeletedEvent = IMEvent & {
  type: "message-deleted";
  messageId: string;
};

export type IMMessageUpdatedEvent = IMEvent & {
  type: "message-updated";
  messageId: string;
  message: Message;
};

// ─── Send Event (outgoing) ──────────────────────────────────────────────────

export type IMSendEvent = IMEvent & {
  type: "send";
  messageId: string;
  message: Message;
};

// ─── Guild Events ───────────────────────────────────────────────────────────

export type IMGuildEvent = IMEvent & {
  type: "guild-added" | "guild-removed" | "guild-updated";
};

export type IMGuildMemberEvent = IMEvent & {
  type: "guild-member-added" | "guild-member-removed" | "guild-member-updated";
};

export type IMGuildRoleEvent = IMEvent & {
  type: "guild-role-created" | "guild-role-deleted" | "guild-role-updated";
  role?: GuildRole;
};

// ─── Login Events ───────────────────────────────────────────────────────────

export type IMLoginEvent = Session & {
  type: "login-added" | "login-removed" | "login-updated";
  login: Login;
};

// ─── Request Events ─────────────────────────────────────────────────────────

export type IMRequestEvent = IMEvent & {
  type: "friend-request" | "guild-request" | "guild-member-request";
  messageId: string;
};

// ─── Friend Events ──────────────────────────────────────────────────────────

export type IMFriendEvent = IMEvent & {
  type: "friend-added";
};

// ─── Reaction Events ────────────────────────────────────────────────────────

export type IMReactionEvent = IMEvent & {
  type: "reaction-added" | "reaction-removed";
  messageId: string;
  emoji?: { id: string; name?: string };
};

// ─── Cordis Events Registration ─────────────────────────────────────────────
// Single source of truth for IM event signatures (satori pattern):
// only `cordis.Events` is declared; there is no parallel event map.
// Internal/platform-specific events are emitted dynamically under their
// `_type` and are declared by the adapters that produce them.

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
  }
}
