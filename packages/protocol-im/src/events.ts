import type { NerveEvent } from "@athena-ai/protocol";

import type { Channel, Guild, GuildMember, Message, User } from "./types.js";

/** Common fields for all IM events. */
export interface IMEvent extends NerveEvent {
  channelId: string;
  userId: string;
}

export interface IMMessageEvent extends IMEvent {
  type: "message-created";
  messageId: string;
  message: Message;
  channel: Channel;
  user: User;
  member?: GuildMember;
  guild?: Guild;
  guildId?: string;
  isDirect: boolean;
}

export interface IMMessageDeletedEvent extends IMEvent {
  type: "message-deleted";
  messageId: string;
}

export interface IMSendEvent extends IMEvent {
  type: "send";
  messageId: string;
  message: Message;
  channel: Channel;
}

declare module "@athena-ai/protocol" {
  interface NerveEventMap {
    "message-created": IMMessageEvent;
    "message-deleted": IMMessageDeletedEvent;
    send: IMSendEvent;
  }
}
