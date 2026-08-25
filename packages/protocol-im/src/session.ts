import { Session } from "@athena-ai/protocol";

import type { Channel, Guild, GuildMember, Message, User } from "./types.js";
import { Channel as ChannelType } from "./types.js";

/**
 * IM-specific Session: the runtime envelope for every IM event, following the
 * Satori Session model. The raw payload lives in `session.event` (extended
 * with IM entity fields via declaration merging), while the derived views
 * below (`content`, `channelId`, `userId`, `guildId`, `isDirect`, ...) are
 * accessors that adapters no longer have to fill in by hand.
 */
export class IMSession extends Session {
  get channel(): Channel | undefined {
    return this.event.channel;
  }

  set channel(value: Channel | undefined) {
    if (value === undefined) return;
    this.event.channel = value;
  }

  get user(): User | undefined {
    return this.event.user;
  }

  set user(value: User | undefined) {
    if (value === undefined) return;
    this.event.user = value;
  }

  get guild(): Guild | undefined {
    return this.event.guild;
  }

  set guild(value: Guild | undefined) {
    if (value === undefined) return;
    this.event.guild = value;
  }

  get message(): Message | undefined {
    return this.event.message;
  }

  set message(value: Message | undefined) {
    if (value === undefined) return;
    this.event.message = value;
  }

  get channelId(): string | undefined {
    return this.event.channel?.id;
  }

  set channelId(value: string | undefined) {
    if (value === undefined) return;
    // SAFETY: `event.channel` is an optional field; a lazily-created empty
    // object plus an assigned `id` is the minimal valid Channel shape.
    (this.event.channel ??= {} as Channel).id = value;
  }

  get userId(): string | undefined {
    return this.event.user?.id;
  }

  set userId(value: string | undefined) {
    if (value === undefined) return;
    // SAFETY: `event.user` is an optional field; a lazily-created empty
    // object plus an assigned `id` is the minimal valid User shape.
    (this.event.user ??= {} as User).id = value;
  }

  get guildId(): string | undefined {
    return this.event.guild?.id;
  }

  set guildId(value: string | undefined) {
    if (value === undefined) return;
    // SAFETY: `event.guild` is an optional field; a lazily-created empty
    // object plus an assigned `id` is the minimal valid Guild shape.
    (this.event.guild ??= {} as Guild).id = value;
  }

  get messageId(): string | undefined {
    return this.event.message?.id;
  }

  set messageId(value: string | undefined) {
    if (value === undefined) return;
    // SAFETY: `event.message` is an optional field; a lazily-created empty
    // object plus an assigned `id` is the minimal valid Message shape.
    (this.event.message ??= {} as Message).id = value;
  }

  get content(): string | undefined {
    return this.event.message?.content;
  }

  set content(value: string | undefined) {
    // SAFETY: `event.message` is an optional field; a lazily-created empty
    // object plus an assigned `content` is the minimal valid Message shape.
    (this.event.message ??= {} as Message).content = value;
  }

  get quote(): Message | undefined {
    return this.event.message?.quote;
  }

  set quote(value: Message | undefined) {
    // SAFETY: `event.message` is an optional field; a lazily-created empty
    // object plus an assigned `quote` is the minimal valid Message shape.
    (this.event.message ??= {} as Message).quote = value;
  }

  get elements(): Message["elements"] {
    return this.event.message?.elements;
  }

  set elements(value: Message["elements"]) {
    // SAFETY: `event.message` is an optional field; a lazily-created empty
    // object plus an assigned `elements` is the minimal valid Message shape.
    (this.event.message ??= {} as Message).elements = value;
  }

  get isDirect(): boolean {
    return this.event.channel?.type === ChannelType.Type.DIRECT;
  }

  set isDirect(value: boolean) {
    // SAFETY: `event.channel` is an optional field; a lazily-created empty
    // object plus an assigned `type` is the minimal valid Channel shape.
    (this.event.channel ??= {} as Channel).type = value ? ChannelType.Type.DIRECT : ChannelType.Type.TEXT;
  }

  get subtype(): string | undefined {
    return this.event.subtype;
  }

  set subtype(value: string | undefined) {
    if (value === undefined) return;
    this.event.subtype = value;
  }

  get member(): GuildMember | undefined {
    return this.event.member;
  }

  set member(value: GuildMember | undefined) {
    if (value === undefined) return;
    this.event.member = value;
  }
}
