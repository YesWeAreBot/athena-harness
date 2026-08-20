import { at, h, image as hImage, omit, transform, Universal } from "@satorijs/core";
import * as qface from "qface";

import type { OneBotBot } from "./bot";
import { CQCode } from "./cqcode";
import * as OneBot from "./types";

export * from "./types";
export { CQCode };

export const decodeUser = (user: OneBot.AccountInfo): Universal.User => ({
  id: user.tiny_id || user.user_id.toString(),
  name: user.nickname,
  avatar: user.user_id ? `http://q.qlogo.cn/headimg_dl?dst_uin=${user.user_id}&spec=640` : undefined,
});

export const decodeGuildMember = (user: OneBot.SenderInfo): Universal.GuildMember => ({
  user: decodeUser(user),
  nick: user.card,
  roles: user.role ? [{ id: user.role }] : [],
});

export async function adaptMessage(
  bot: OneBotBot,
  data: OneBot.Message,
  message: Universal.Message = {},
  payload: Universal.MessageLike | undefined = message,
) {
  message.id = data.message_id.toString();

  // message content
  const chain = CQCode.parse(data.message);
  if (bot.config.advanced?.splitMixedContent) {
    chain.forEach((item, index) => {
      if (item.type !== "image") return;
      const left = chain[index - 1];
      if (left && left.type === "text" && left.attrs.content.trimEnd() === left.attrs.content) {
        left.attrs.content += " ";
      }
      const right = chain[index + 1];
      if (right && right.type === "text" && right.attrs.content.trimStart() === right.attrs.content) {
        right.attrs.content = " " + right.attrs.content;
      }
    });
  }

  message.elements = transform(chain, {
    at(attrs) {
      if (attrs.qq !== "all") return at(attrs.qq, { name: attrs.name });
      return h("at", { type: "all" });
    },
    face({ id }) {
      const name = qface.get(id)?.QDes.slice(1);
      return h("face", { id, name, platform: bot.platform }, [hImage(qface.getUrl(id))]);
    },
    image(attrs) {
      return h("img", {
        src: attrs.url || attrs.file,
        ...omit(attrs, ["url"]),
      });
    },
    record(attrs) {
      return h("audio", {
        src: attrs.url || attrs.file,
        ...omit(attrs, ["url"]),
      });
    },
    video(attrs) {
      return h("video", {
        src: attrs.url || attrs.file,
        ...omit(attrs, ["url"]),
      });
    },
    file(attrs) {
      return h("file", {
        src: attrs.url || attrs.file,
        ...omit(attrs, ["url"]),
      });
    },
  });
  const [guildId, channelId] = decodeGuildChannelId(data);
  if (message.elements?.[0]?.type === "reply") {
    const reply = message.elements.shift()!;
    message.quote = await bot.getMessage(channelId!, reply.attrs.id).catch((error) => {
      bot.ctx.logger("onebot").warn(error);
      return undefined;
    });
  }
  message.content = message.elements?.join("") ?? "";

  if (!payload) return message;
  payload.user = decodeUser(data.sender);
  payload.member = decodeGuildMember(data.sender);
  payload.timestamp = data.time * 1000;
  payload.guild = guildId ? { id: guildId } : undefined;
  payload.channel = channelId ? { id: channelId, type: guildId ? Universal.Channel.Type.TEXT : Universal.Channel.Type.DIRECT } : undefined;
  return message;
}

function decodeGuildChannelId(data: OneBot.Message): [string | undefined, string | undefined] {
  if (data.guild_id) {
    return [data.guild_id, data.channel_id];
  } else if (data.group_id) {
    return [data.group_id.toString(), data.group_id.toString()];
  } else {
    return [undefined, "private:" + data.sender.user_id];
  }
}

export const adaptGuild = (info: OneBot.GroupInfo | OneBot.GuildBaseInfo): Universal.Guild => {
  if ((info as OneBot.GuildBaseInfo).guild_id) {
    const guild = info as OneBot.GuildBaseInfo;
    return {
      id: guild.guild_id,
      name: guild.guild_name,
    };
  } else {
    const group = info as OneBot.GroupInfo;
    return {
      id: group.group_id.toString(),
      name: group.group_name,
    };
  }
};

export const adaptChannel = (info: OneBot.GroupInfo | OneBot.ChannelInfo): Universal.Channel => {
  if ((info as OneBot.ChannelInfo).channel_id) {
    const channel = info as OneBot.ChannelInfo;
    return {
      id: channel.channel_id,
      name: channel.channel_name,
      type: Universal.Channel.Type.TEXT,
    };
  } else {
    const group = info as OneBot.GroupInfo;
    return {
      id: group.group_id.toString(),
      name: group.group_name,
      type: Universal.Channel.Type.TEXT,
    };
  }
};

export async function dispatchSession(bot: OneBotBot, data: OneBot.Payload) {
  const session = await adaptSession(bot, data);
  if (!session) return;
  session.setInternal("onebot", data);
  bot.dispatch(session);
}

// Session.event is dynamically extensible; subtype is set via defineAccessor
interface DynamicEvent extends Universal.Event {
  subtype?: string;
}

export async function adaptSession(bot: OneBotBot, data: OneBot.Payload) {
  const session = bot.session();
  const event = session.event as DynamicEvent;
  session.selfId = "" + data.self_id;
  session.type = data.post_type;

  if (data.post_type === "message" || data.post_type === "message_sent") {
    await adaptMessage(bot, data, (session.event.message = {}), session.event);
    if (data.post_type === "message_sent" && !session.guildId) {
      session.channelId = "private:" + data.target_id;
    }
    session.type = "message";
    event.subtype = data.message_type === "guild" ? "group" : data.message_type;
    session.isDirect = data.message_type === "private";
    if (data.sender?.user_id) session.userId = "" + data.sender.user_id;
    if (data.message_type === "private") {
      session.channelId = "private:" + data.sender.user_id;
      if (data.sub_type === "group" && data.target_id) {
        session.guildId = "" + data.target_id;
      }
    } else if (data.message_type === "group") {
      session.channelId = "" + data.group_id;
      session.guildId = "" + data.group_id;
    }
    return session;
  }

  event.subtype = data.sub_type;
  if (data.user_id) session.userId = "" + data.user_id;
  if (data.group_id) session.guildId = session.channelId = "" + data.group_id;
  if (data.guild_id) session.guildId = "" + data.guild_id;
  if (data.channel_id) session.channelId = "" + data.channel_id;
  if (data.operator_id) session.operatorId = "" + data.operator_id;
  if (data.message_id) session.messageId = "" + data.message_id;

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
        event.subtype = "group";
        break;
      case "friend_recall":
        session.type = "message-deleted";
        event.subtype = "private";
        session.channelId = `private:${session.userId}`;
        break;
      case "guild_channel_recall":
        session.type = "message-deleted";
        event.subtype = "guild";
        break;
      case "friend_add":
        session.type = "friend-added";
        break;
      case "group_admin":
        session.type = "guild-member-updated";
        event.subtype = "role";
        break;
      case "group_ban":
        session.type = "guild-member-updated";
        event.subtype = "ban";
        break;
      case "group_decrease":
        session.type = session.userId === session.selfId ? "guild-removed" : "guild-member-removed";
        event.subtype = session.userId === session.operatorId ? "active" : "passive";
        break;
      case "group_increase":
        session.type = session.userId === session.selfId ? "guild-added" : "guild-member-added";
        event.subtype = session.userId === session.operatorId ? "active" : "passive";
        break;
      case "group_card":
        session.type = "guild-member-updated";
        event.subtype = "nickname";
        break;
      case "notify":
        session.type = "internal";
        session.event._type = "onebot/notify";
        session.event._data = data;
        break;
      case "message_reactions_updated":
        session.type = "internal";
        session.event._type = "onebot/message-reactions-updated";
        session.event._data = data;
        break;
      default:
        return;
    }
  } else return;

  return session;
}
