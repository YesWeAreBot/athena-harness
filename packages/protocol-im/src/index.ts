import type { Element } from "@cordisjs/element";

import type { Channel, Guild, GuildMember, List, Message, SendOptions, User } from "./types.js";

declare module "@athena-ai/protocol" {
  interface NerveEvent {
    channelId?: string;
    guildId?: string;
    userId?: string;
    messageId?: string;
    message?: Message;
    channel?: Channel;
    guild?: Guild;
    user?: User;
    member?: GuildMember;
    isDirect?: boolean;
  }

  interface Body {
    sendMessage(channelId: string, content: Element[], options?: SendOptions): Promise<Message[]>;
    sendPrivateMessage(userId: string, content: Element[], guildId?: string, options?: SendOptions): Promise<string[]>;
    getMessage(channelId: string, messageId: string): Promise<Message>;
    getMessageList(channelId: string, next?: string, direction?: "before" | "after"): Promise<List<Message>>;
    deleteMessage(channelId: string, messageId: string): Promise<void>;
    createDirectChannel(userId: string, guildId?: string): Promise<Channel>;
    getChannel(channelId: string): Promise<Channel>;
    getUser(userId: string): Promise<User>;
    getGuild(guildId: string): Promise<Guild>;
    getGuildMember(guildId: string, userId: string): Promise<GuildMember>;
  }
}

declare module "cordis" {
  interface Events {
    "message-created"(event: import("./events.js").IMMessageEvent): void;
    "message-deleted"(event: import("./events.js").IMMessageDeletedEvent): void;
    send(event: import("./events.js").IMSendEvent): void;
  }
}

export { MessageEncoder } from "./encoder.js";
export type { IMEvent, IMMessageDeletedEvent, IMMessageEvent, IMSendEvent } from "./events.js";
export type { Channel, Guild, GuildMember, List, Message, SendOptions, User } from "./types.js";
