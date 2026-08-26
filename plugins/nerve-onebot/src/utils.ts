import type { Session } from "@athena-ai/protocol";
import type { Channel, Guild, GuildMember, Message, User } from "@athena-ai/protocol-im";
import { Element, transform } from "@cordisjs/element";
import * as qface from "qface";

import { CQCode } from "./bot/cqcode.js";
import type { OneBotBody } from "./bot/index.js";
import type * as OneBot from "./types.js";

export const PRIVATE_PFX = "private:";

// ─── Decode helpers ─────────────────────────────────────────────────────────

export function decodeUser(data: OneBot.AccountInfo): User & { userId: string; username: string } {
  const id = data.tiny_id || data.user_id.toString();
  return {
    id,
    name: data.nickname,
    userId: id,
    avatar: data.user_id ? `http://q.qlogo.cn/headimg_dl?dst_uin=${data.user_id}&spec=640` : undefined,
    username: data.nickname,
  };
}

export function decodeGuildMember(data: OneBot.SenderInfo): GuildMember {
  return {
    user: decodeUser(data),
    nick: data.card,
    roles: data.role ? [{ id: data.role }] : [],
  };
}

const decodeGuildChannelId = (data: OneBot.Message) => {
  if (data.guild_id) {
    return [data.guild_id, data.channel_id];
  } else if (data.group_id) {
    return [data.group_id.toString(), data.group_id.toString()];
  } else {
    return [undefined, `private:${data.sender.user_id}`];
  }
};

export async function adaptMessage(
  body: OneBotBody,
  data: OneBot.Message,
  // SAFETY: empty object is populated field-by-field below; the cast initializes the accumulator (koishi pattern).
  message: Message = {} as Message,
  // SAFETY: message doubles as the payload accumulator when called from adaptSession (koishi dual-param pattern);
  // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- message and payload are the same object for field accumulation (koishi pattern).
  payload: Partial<{ user: User; member: GuildMember; timestamp: number; guild: { id: string }; channel: Channel }> | null = message as unknown as Partial<{
    user: User;
    member: GuildMember;
    timestamp: number;
    guild: { id: string };
    channel: Channel;
  }>,
): Promise<Message> {
  message.id = data.message_id.toString();

  // message content
  const chain = CQCode.parse(data.message);
  if (body.config.advanced?.splitMixedContent) {
    chain.forEach((item, index) => {
      if (item.type !== "image") return;
      const left = chain[index - 1];
      if (left && left.type === "text" && left.attrs.content.trimEnd() === left.attrs.content) {
        left.attrs.content += " ";
      }
      const right = chain[index + 1];
      if (right && right.type === "text" && right.attrs.content.trimStart() === right.attrs.content) {
        right.attrs.content = ` ${right.attrs.content}`;
      }
    });
  }

  message.elements = transform(chain, {
    at(attrs) {
      if (attrs.qq !== "all") return Element("at", { id: attrs.qq, name: attrs.name });
      return Element("at", { type: "all" });
    },
    face({ id }) {
      const name = qface.get(id)?.QDes.slice(1);
      return Element("face", { id, name, platform: body.platform }, [Element("img", { src: qface.getUrl(id) })]);
    },
    image(attrs) {
      const { url, file, ...rest } = attrs;
      return Element("img", { src: url || file, ...rest });
    },
    record(attrs) {
      const { url, file, ...rest } = attrs;
      return Element("audio", { src: url || file, ...rest });
    },
    video(attrs) {
      const { url, file, ...rest } = attrs;
      return Element("video", { src: url || file, ...rest });
    },
    file(attrs) {
      const { url, file, ...rest } = attrs;
      return Element("file", { src: url || file, ...rest });
    },
  });

  const [guildId, channelId] = decodeGuildChannelId(data);
  if (message.elements[0]?.type === "reply") {
    const reply = message.elements.shift()!;
    message.quote = await body.getMessage(channelId!, reply.attrs.id).catch((error) => {
      body.ctx.logger("onebot").warn(error);
      return undefined;
    });
  }
  message.content = message.elements.map((el) => el.toString()).join("");

  if (!payload) return message;
  payload.user = decodeUser(data.sender);
  payload.member = decodeGuildMember(data.sender);
  payload.timestamp = data.time * 1000;
  payload.guild = guildId ? { id: guildId } : undefined;
  payload.channel = channelId ? { id: channelId, type: guildId ? 0 : 1 } : undefined;
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
    name: info.group_name,
    type: 0,
  };
}

// ─── Event dispatch ─────────────────────────────────────────────────────────

export async function dispatchSession(body: OneBotBody, data: OneBot.Payload): Promise<void> {
  const session = await adaptSession(body, data);
  if (!session) return;
  session.event.onebot = data;
  if (session.type !== "internal") {
    session.setInternal("onebot", data);
  }
  body.dispatch(session);
}

async function adaptSession(body: OneBotBody, data: OneBot.Payload): Promise<Session | undefined> {
  const session = body.session();
  session.selfId = data.self_tiny_id ? data.self_tiny_id : `${data.self_id}`;
  session.type = "";

  if (data.post_type === "message" || data.post_type === "message_sent") {
    // SAFETY: session.event is the wire payload; koishi pattern fills nested `message` and event fields by reference.
    await adaptMessage(body, data, ((session as any).event.message = {}), (session as any).event);
    if (data.post_type === "message_sent" && !session.guildId) {
      session.channelId = `private:${data.target_id}`;
    }
    session.type = "message-created";
    session.subtype = data.message_type === "guild" ? "group" : data.message_type;
    session.isDirect = data.message_type === "private";
    if (data.sender?.user_id) session.userId = `${data.sender.user_id}`;
    if (data.message_type === "private") {
      session.channelId = `private:${data.sender.user_id}`;
      if (data.sub_type === "group" && data.target_id) {
        session.guildId = `${data.target_id}`;
      }
    } else if (data.message_type === "group") {
      session.channelId = `${data.group_id}`;
      session.guildId = `${data.group_id}`;
    }
    return session;
  }

  session.subtype = data.sub_type;
  if (data.user_id) session.userId = `${data.user_id}`;
  if (data.group_id) session.guildId = session.channelId = `${data.group_id}`;
  if (data.guild_id) session.guildId = `${data.guild_id}`;
  if (data.channel_id) session.channelId = `${data.channel_id}`;
  // SAFETY: operatorId is set dynamically for notice events; Session type does not declare it (koishi pattern).
  // oxlint-disable-next-line anti-slop/require-safety-comment-for-type-assertion
  if (data.operator_id) (session as any).operatorId = `${data.operator_id}`;
  if (data.message_id) session.messageId = `${data.message_id}`;

  if (data.post_type === "request") {
    session.content = data.comment;
    session.messageId = data.flag;
    if (data.request_type === "friend") {
      session.type = "friend-request";
      session.channelId = `private:${session.userId}`;
    } else if (data.sub_type === "add") {
      session.type = "guild-member-request";
    } else {
      session.type = "guild-request";
    }
  } else if (data.post_type === "notice") {
    switch (data.notice_type) {
      case "group_recall":
        session.type = "message-deleted";
        session.subtype = "group";
        break;
      case "friend_recall":
        session.type = "message-deleted";
        session.subtype = "private";
        session.channelId = `private:${session.userId}`;
        break;
      case "friend_add":
        session.type = "friend-added";
        break;
      case "group_admin":
        session.type = "guild-member-updated";
        session.subtype = "role";
        break;
      case "group_ban":
        session.type = "guild-member-updated";
        session.subtype = "ban";
        break;
      case "group_decrease":
        session.type = session.userId === session.selfId ? "guild-deleted" : "guild-member-deleted";
        // SAFETY: operatorId was set dynamically above from data.operator_id (koishi pattern);
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions
        session.subtype = session.userId === (session as unknown as { operatorId?: string }).operatorId ? "active" : "passive";
        break;
      case "group_increase":
        session.type = session.userId === session.selfId ? "guild-added" : "guild-member-added";
        // SAFETY: operatorId was set dynamically above from data.operator_id (koishi pattern);
        // oxlint-disable-next-line anti-slop/no-chained-type-assertions
        session.subtype = session.userId === (session as unknown as { operatorId?: string }).operatorId ? "active" : "passive";
        break;
      case "group_card":
        session.type = "guild-member-updated";
        session.subtype = "nickname";
        break;
      case "notify": {
        session.type = "internal";
        session.setInternal(`onebot/${data.sub_type}`, data);
        break;
      }
      case "message_reactions_updated": {
        session.type = "internal";
        session.setInternal("onebot/message-reactions-updated", data);
        break;
      }
      case "offline_file":
        session.type = "message-created";
        session.subtype = "private";
        session.channelId = `private:${session.userId}`;
        if (data.file) session.elements = [Element("file", data.file)];
        break;
      case "group_upload":
        session.type = "message-created";
        session.subtype = "group";
        if (data.file) session.elements = [Element("file", data.file)];
        break;
      default:
        return undefined;
    }
  } else return undefined;

  return session;
}
