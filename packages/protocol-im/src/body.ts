import { Body } from "@athena-ai/protocol";
import type { Fragment } from "@cordisjs/element";
import type { Context } from "cordis";

// Side-effect import: attaches the IM Session accessors (defineAccessor)
// to the base Session prototype. Adapters always import IMBody, which
// guarantees the runtime views exist wherever a body is created.
import "./session.js";
import { Methods } from "./types.js";
import type { BidiList, Channel, Direction, Friend, Guild, GuildMember, GuildRole, List, Login, Message, Order, SendOptions, User } from "./types.js";

/**
 * Full IM method surface. Adapters implement a subset — methods they do
 * not support are simply absent on the prototype, detected at runtime via
 * `supports()` / `features`. No base class provides placeholders.
 */
export interface IMMethods {
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

/**
 * Marker interface: a Body that participates in IM.
 *
 * Interface-class merging (satori pattern): the interface contributes the
 * full `IMMethods` surface to the type system, while the class only
 * carries the runtime behavior (lifecycle via `Body`, capability
 * detection, composite defaults). Adapters `extends IMBody` and implement
 * only the subset they support — TypeScript does not require the rest, and
 * missing methods are simply `undefined` at runtime.
 */
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: interface declares the full IM surface, class carries runtime behavior (satori Bot pattern)
export interface IMBody extends IMMethods {}

export abstract class IMBody<C = unknown> extends Body<C> {
  /** Wire-level capability names implemented by this body (satori pattern). */
  public features: string[];

  constructor(ctx: Context, config: C) {
    super(ctx, config);
    // Auto-detect implemented methods (satori pattern).
    this.features = Object.entries(Methods)
      .filter(([, method]) => this.hasMethod(method.name))
      .map(([key]) => key);
  }

  /** Check whether this body supports a wire-level method name. */
  supports(name: string): boolean {
    const method = Methods[name];
    return !!method && this.hasMethod(method.name);
  }

  /**
   * Whether this body implements the method named by a Methods table entry.
   * Three call sites (constructor scan, supports(), potential external use)
   * justify a shared helper rather than inlining the instanceof check.
   */
  private hasMethod(name: string): boolean {
    // SAFETY: `name` comes from the static Methods table (not external
    // input); the IMBody surface declares every entry, so the key is valid.
    const key = name as keyof this;
    return this[key] instanceof Function;
  }

  // ─── Composite defaults (the only implemented methods) ──────────────────

  async sendMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<string[]> {
    const messages = await this.createMessage(channelId, content, options);
    return messages.map((m) => m.id).filter((id): id is string => !!id);
  }

  async sendPrivateMessage(userId: string, content: Fragment, guildId?: string, options?: SendOptions): Promise<string[]> {
    const { id } = await this.createDirectChannel(userId, guildId);
    return this.sendMessage(id, content, options);
  }

  // ─── Minimal abstract surface (adapters MUST provide these) ─────────────

  abstract createMessage(channelId: string, content: Fragment, options?: SendOptions): Promise<Message[]>;
  abstract createDirectChannel(userId: string, guildId?: string): Promise<Channel>;
}

// ─── BodyRegistry 注入 ───────────────────────────────────────────────────────
// protocol-im registers the IM capability so that `ctx.nerve.get(...)`
// and Cortex code see `AnyBody = IMBody` when only this package is
// imported (import 即合并).

declare module "@athena-ai/protocol" {
  interface BodyRegistry {
    im: IMBody;
  }
}
