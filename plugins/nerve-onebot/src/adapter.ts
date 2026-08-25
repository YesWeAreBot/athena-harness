import type { Event, Session } from "@athena-ai/protocol";
import type { Channel, Guild, GuildMember, Message, User } from "@athena-ai/protocol-im";

import type { OneBotBody } from "./body.js";
import { CQCode } from "./cqcode.js";
import type * as OneBot from "./types.js";

export const PRIVATE_PFX = "private:";

// ─── Decode helpers ─────────────────────────────────────────────────────────

export function decodeUser(data: OneBot.AccountInfo): User {
  return {
    id: data.tiny_id ?? data.user_id.toString(),
    name: data.nickname,
    avatar: data.user_id ? `http://q.qlogo.cn/headimg_dl?dst_uin=${data.user_id}&spec=640` : undefined,
  };
}

export function decodeGuildMember(data: OneBot.SenderInfo): GuildMember {
  return {
    user: decodeUser(data),
    nick: data.card,
    roles: data.role ? [{ id: data.role }] : [],
  };
}

function decodeGuildChannelId(data: OneBot.Message): [guildId: string | undefined, channelId: string | undefined] {
  if (data.guild_id) return [data.guild_id, data.channel_id];
  if (data.group_id) return [data.group_id.toString(), data.group_id.toString()];
  return [undefined, `${PRIVATE_PFX}${data.sender.user_id}`];
}

export async function adaptMessage(body: OneBotBody, data: OneBot.Message): Promise<Message> {
  const elements = CQCode.parse(data.message);
  const [guildId, channelId] = decodeGuildChannelId(data);
  const message: Message = {
    id: data.message_id.toString(),
    elements,
    user: decodeUser(data.sender),
    member: decodeGuildMember(data.sender),
    timestamp: data.time * 1000,
    guild: guildId ? { id: guildId } : undefined,
    channel: channelId ? { id: channelId, type: guildId ? 0 : 1 } : undefined,
  };
  // Koishi semantics: a leading reply element becomes `message.quote`, fetched
  // eagerly; the remaining elements serialize into `content` (at/face included).
  if (elements[0]?.type === "reply") {
    const reply = elements.shift()!;
    message.quote = await body.getMessage(channelId!, reply.attrs.id).catch((error) => {
      body.ctx.logger("onebot").warn("failed to fetch quoted message:", error);
      return undefined;
    });
  }
  message.content = elements.map((el) => el.toString()).join("");
  return message;
}

export function adaptGuild(info: OneBot.GroupInfo): Guild {
  return {
    id: info.group_id.toString(),
    name: info.group_name,
  };
}

export function adaptChannel(info: OneBot.GroupInfo): Channel {
  return {
    id: info.group_id.toString(),
    type: 0,
    name: info.group_name,
  };
}

// ─── Event dispatch ─────────────────────────────────────────────────────────

/**
 * Convert a raw OneBot payload into a Session and dispatch it.
 * Handles message, notice, and request post_types.
 */
export async function dispatchEvent(body: OneBotBody, data: OneBot.Payload): Promise<void> {
  const session = await adaptSession(body, data);
  if (!session) return;
  body.dispatch(session);
}

async function adaptSession(body: OneBotBody, data: OneBot.Payload): Promise<Session | undefined> {
  const event: Partial<Event> = {
    type: "",
    id: Math.random().toString(36).slice(2),
    timestamp: data.time * 1000,
  };

  if (data.post_type === "message" || data.post_type === "message_sent") {
    return adaptMessageEvent(body, data, event);
  }
  if (data.post_type === "notice") {
    return adaptNoticeEvent(body, data, event);
  }
  if (data.post_type === "request") {
    return adaptRequestEvent(body, data, event);
  }
  return undefined;
}

// ─── Message events ─────────────────────────────────────────────────────────

async function adaptMessageEvent(body: OneBotBody, data: OneBot.Payload, base: Partial<Event>): Promise<Session> {
  const message = await adaptMessage(body, data);
  const isDirect = data.message_type === "private";
  let channelId = isDirect ? `${PRIVATE_PFX}${data.sender.user_id}` : String(data.group_id);
  const guildId = isDirect ? (data.sub_type === "group" && data.target_id ? String(data.target_id) : undefined) : String(data.group_id);

  // Handle message_sent (self-sent messages) — special channelId for private
  if (data.post_type === "message_sent" && isDirect && data.target_id) {
    channelId = `${PRIVATE_PFX}${data.target_id}`;
  }

  const session = body.session({
    ...base,
    type: "message-created",
    id: `ob_${data.message_id}`,
    message,
    channel: { id: channelId, type: isDirect ? 1 : 0 },
    user: decodeUser(data.sender),
    member: decodeGuildMember(data.sender),
    guild: guildId ? { id: guildId } : undefined,
    subtype: data.message_type === "guild" ? "group" : data.message_type,
  });
  return session;
}

// ─── Notice events ──────────────────────────────────────────────────────────

function adaptNoticeEvent(body: OneBotBody, data: OneBot.Payload, base: Partial<Event>): Session | undefined {
  const userId = data.user_id ? String(data.user_id) : "";
  const channelId = data.group_id ? String(data.group_id) : `${PRIVATE_PFX}${userId}`;
  const guildId = data.group_id ? String(data.group_id) : undefined;
  const operatorId = data.operator_id ? String(data.operator_id) : undefined;
  const messageId = data.message_id ? String(data.message_id) : undefined;

  const common = {
    ...base,
    // SAFETY: the ternary guarantees the value is exactly 0 (guild) or 1 (direct).
    channel: { id: channelId, type: (guildId ? 0 : 1) as 0 | 1 },
    user: userId ? { id: userId } : undefined,
    guild: guildId ? { id: guildId } : undefined,
  };

  switch (data.notice_type) {
    case "group_recall":
      return body.session({ ...common, type: "message-deleted", message: { id: messageId ?? "" }, subtype: "group" });
    case "friend_recall":
      return body.session({
        ...common,
        type: "message-deleted",
        channel: { id: `${PRIVATE_PFX}${userId}`, type: 1 },
        message: { id: messageId ?? "" },
        subtype: "private",
      });
    case "guild_channel_recall":
      return body.session({ ...common, type: "message-deleted", message: { id: messageId ?? "" }, subtype: "guild" });
    case "friend_add":
      return body.session({ ...common, type: "friend-added" });
    case "group_admin":
      return body.session({ ...common, type: "guild-member-updated", subtype: "role" });
    case "group_ban":
      return body.session({ ...common, type: "guild-member-updated", subtype: "ban" });
    case "group_decrease":
      return body.session({
        ...common,
        type: userId === body.selfId ? "guild-removed" : "guild-member-removed",
        subtype: userId === operatorId ? "active" : "passive",
      });
    case "group_increase":
      return body.session({
        ...common,
        type: userId === body.selfId ? "guild-added" : "guild-member-added",
        subtype: userId === operatorId ? "active" : "passive",
      });
    case "group_card":
      return body.session({ ...common, type: "guild-member-updated", subtype: "nickname" });
    case "notify": {
      const pokeChannelId = data.sub_type === "poke" && !channelId.startsWith(PRIVATE_PFX) ? `${PRIVATE_PFX}${userId}` : channelId;
      const session = body.session({ ...common, channel: { id: pokeChannelId, type: 1 }, type: "internal" });
      session.setInternal(`onebot/${data.sub_type}`, data);
      return session;
    }
    case "message_reactions_updated": {
      const session = body.session({ ...common, type: "internal" });
      session.setInternal("onebot/message-reactions-updated", data);
      return session;
    }
    case "channel_created": {
      const session = body.session({ ...common, type: "internal" });
      session.setInternal("onebot/channel-created", data);
      return session;
    }
    case "channel_updated": {
      const session = body.session({ ...common, type: "internal" });
      session.setInternal("onebot/channel-updated", data);
      return session;
    }
    case "channel_destroyed": {
      const session = body.session({ ...common, type: "internal" });
      session.setInternal("onebot/channel-destroyed", data);
      return session;
    }
    default:
      return undefined;
  }
}

// ─── Request events ─────────────────────────────────────────────────────────

function adaptRequestEvent(body: OneBotBody, data: OneBot.Payload, base: Partial<Event>): Session | undefined {
  const userId = data.user_id ? String(data.user_id) : "";
  const guildId = data.group_id ? String(data.group_id) : undefined;
  const channelId = guildId ?? `${PRIVATE_PFX}${userId}`;

  const common = {
    ...base,
    // SAFETY: the ternary guarantees the value is exactly 0 (guild) or 1 (direct).
    channel: { id: channelId, type: (guildId ? 0 : 1) as 0 | 1 },
    user: userId ? { id: userId } : undefined,
    guild: guildId ? { id: guildId } : undefined,
    message: { id: data.flag ?? "", content: data.comment },
  };

  if (data.request_type === "friend") {
    return body.session({ ...common, type: "friend-request", channel: { id: `${PRIVATE_PFX}${userId}`, type: 1 } });
  }
  if (data.sub_type === "add") {
    return body.session({ ...common, type: "guild-member-request" });
  }
  return body.session({ ...common, type: "guild-request" });
}
