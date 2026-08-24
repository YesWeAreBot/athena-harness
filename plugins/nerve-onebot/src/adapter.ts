import type { GuildMember, IMMessageEvent, Message, User } from "@athena-ai/protocol-im";

import type { OneBotBody } from "./body.js";
import { CQCode } from "./cqcode.js";
import type * as OneBot from "./types.js";

export const PRIVATE_PFX = "private:";

export function decodeUser(data: OneBot.AccountInfo): User {
  return {
    id: data.tiny_id ?? data.user_id.toString(),
    name: data.nickname,
    avatar: `http://q.qlogo.cn/headimg_dl?dst_uin=${data.user_id}&spec=640`,
  };
}

export function decodeGuildMember(data: OneBot.SenderInfo): GuildMember {
  return {
    user: decodeUser(data),
    nick: data.card,
    roles: data.role ? [{ id: data.role }] : [],
  };
}

export function adaptMessage(data: OneBot.Message): Message {
  const elements = CQCode.parse(data.message);
  return {
    id: data.message_id.toString(),
    elements,
    content: elements
      .filter((element) => element.type === "text")
      .map((element) => String(element.attrs.content ?? ""))
      .join(""),
    user: decodeUser(data.sender),
    member: decodeGuildMember(data.sender),
    timestamp: data.time * 1000,
  };
}

/** Restrict Nerve event adaptation to the currently migrated OneBot message path. */
export function dispatchEvent(body: OneBotBody, data: OneBot.Payload): void {
  if (!isMessagePayload(data)) return;

  const message = adaptMessage(data);
  const isDirect = data.message_type === "private";
  const channelId = isDirect ? `${PRIVATE_PFX}${data.sender.user_id}` : String(data.group_id);
  const guildId = isDirect ? (data.sub_type === "group" && data.target_id ? String(data.target_id) : undefined) : String(data.group_id);

  const event: IMMessageEvent = {
    type: "message-created",
    id: `ob_${data.message_id}`,
    selfId: body.selfId,
    platform: body.platform,
    timestamp: data.time * 1000,
    body,
    channelId,
    userId: String(data.sender.user_id),
    messageId: data.message_id.toString(),
    message,
    channel: { id: channelId, type: isDirect ? 1 : 0 },
    user: decodeUser(data.sender),
    member: decodeGuildMember(data.sender),
    guild: guildId ? { id: guildId } : undefined,
    guildId,
    isDirect,
  };
  body.dispatch(event);
}

function isMessagePayload(data: OneBot.Payload): data is OneBot.MessagePayload {
  return data.post_type === "message" || data.post_type === "message_sent";
}
