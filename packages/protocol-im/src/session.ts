import { Session } from "@athena-ai/protocol";
import { defineAccessor } from "@athena-ai/protocol";

import type { Channel, Guild, GuildMember, Message, User } from "./types.js";
import { Channel as ChannelType } from "./types.js";

/**
 * IM accessors attached to the base `Session` prototype via
 * `defineAccessor` (deep-path get/set with lazy creation) and computed
 * properties. There is no `IMSession` subclass — protocol-im merges the
 * IM views directly onto the runtime envelope, so adapters only fill the
 * nested data objects (`channel`/`user`/`guild`/`message`) and every
 * derived field (`channelId`, `userId`, `content`, `isDirect`, ...) is
 * inferred automatically.
 */

// Deep-path accessors (satori pattern: one line per property).
defineAccessor(Session.prototype, "channel", ["event", "channel"]);
defineAccessor(Session.prototype, "user", ["event", "user"]);
defineAccessor(Session.prototype, "guild", ["event", "guild"]);
defineAccessor(Session.prototype, "message", ["event", "message"]);
defineAccessor(Session.prototype, "channelId", ["event", "channel", "id"]);
defineAccessor(Session.prototype, "channelName", ["event", "channel", "name"]);
defineAccessor(Session.prototype, "userId", ["event", "user", "id"]);
defineAccessor(Session.prototype, "guildId", ["event", "guild", "id"]);
defineAccessor(Session.prototype, "guildName", ["event", "guild", "name"]);
defineAccessor(Session.prototype, "messageId", ["event", "message", "id"]);
defineAccessor(Session.prototype, "quote", ["event", "message", "quote"]);
defineAccessor(Session.prototype, "elements", ["event", "message", "elements"]);
defineAccessor(Session.prototype, "member", ["event", "member"]);
defineAccessor(Session.prototype, "subtype", ["event", "subtype"]);

// Computed accessors that need logic beyond path traversal.
Object.defineProperty(Session.prototype, "content", {
  get() {
    return this.event.message?.content;
  },
  set(value: string | undefined) {
    // SAFETY: `event.message` is an optional field; a lazily-created empty
    // object plus an assigned `content` is the minimal valid Message shape.
    (this.event.message ??= {} as Message).content = value;
  },
  configurable: true,
});

Object.defineProperty(Session.prototype, "isDirect", {
  get() {
    return this.event.channel?.type === ChannelType.Type.DIRECT;
  },
  set(value: boolean) {
    // SAFETY: `event.channel` is an optional field; a lazily-created empty
    // object plus an assigned `type` is the minimal valid Channel shape.
    (this.event.channel ??= {} as Channel).type = value ? ChannelType.Type.DIRECT : ChannelType.Type.TEXT;
  },
  configurable: true,
});

// Type-level declarations for the IM views (merged onto Session).
declare module "@athena-ai/protocol" {
  // Event payload extension: IM entities as optional fields on the wire event.
  interface Event {
    channel?: Channel;
    guild?: Guild;
    user?: User;
    member?: GuildMember;
    message?: Message;
    quote?: Message;
    subtype?: string;
  }

  // Session accessor views: derived from Event fields via defineAccessor.
  interface Session {
    channel?: Channel;
    user?: User;
    guild?: Guild;
    message?: Message;
    channelId?: string;
    channelName?: string;
    userId?: string;
    guildId?: string;
    guildName?: string;
    messageId?: string;
    quote?: Message;
    elements?: Message["elements"];
    member?: GuildMember;
    subtype?: string;
    /** Computed: message content (koishi semantics, elements serialized). */
    content?: string;
    /** Computed: whether this is a direct message. */
    isDirect: boolean;
  }
}
