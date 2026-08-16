import type { NormalizedOneBotEvent, OneBotEvent, OneBotMessageSegment, OneBotPercept } from "./types.js";

export function parseOneBotEvent(raw: unknown): OneBotEvent {
  if (!raw || typeof raw !== "object") {
    throw new Error("OneBot event must be an object");
  }
  const event = raw as OneBotEvent;
  if (typeof event.post_type !== "string") {
    throw new Error("OneBot event is missing post_type");
  }
  return event;
}

export function normalizeOneBotEvent(event: OneBotEvent): NormalizedOneBotEvent {
  return {
    postType: event.post_type,
    ...(event.self_id === undefined ? {} : { selfId: String(event.self_id) }),
    ...(event.time === undefined ? {} : { time: event.time }),
    ...(event.message_type === undefined ? {} : { messageType: event.message_type }),
    ...(event.sub_type === undefined ? {} : { subType: event.sub_type }),
    ...(event.message_id === undefined ? {} : { messageId: String(event.message_id) }),
    ...(event.user_id === undefined ? {} : { userId: String(event.user_id) }),
    ...(event.group_id === undefined ? {} : { groupId: String(event.group_id) }),
    ...(event.guild_id === undefined ? {} : { guildId: String(event.guild_id) }),
    ...(event.channel_id === undefined ? {} : { channelId: String(event.channel_id) }),
    ...(event.target_id === undefined ? {} : { targetId: String(event.target_id) }),
    ...(event.operator_id === undefined ? {} : { operatorId: String(event.operator_id) }),
    ...(event.raw_message === undefined ? {} : { rawMessage: event.raw_message }),
    message: normalizeMessageSegments(event.message),
    ...(event.sender === undefined ? {} : { sender: event.sender }),
    ...(event.notice_type === undefined ? {} : { noticeType: event.notice_type }),
    ...(event.request_type === undefined ? {} : { requestType: event.request_type }),
    ...(event.meta_event_type === undefined ? {} : { metaEventType: event.meta_event_type }),
    ...(event.comment === undefined ? {} : { comment: event.comment }),
    ...(event.flag === undefined ? {} : { flag: event.flag }),
    raw: event,
  };
}

export function normalizeMessageSegments(message: unknown): readonly OneBotMessageSegment[] {
  if (Array.isArray(message)) {
    return message
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
      .map((item) => {
        const type = typeof item.type === "string" ? item.type : "unknown";
        const data = item.data && typeof item.data === "object" ? (item.data as Record<string, unknown>) : {};
        return { type, data };
      });
  }
  if (typeof message === "string") {
    return [{ type: "text", data: { text: message } }];
  }
  return [];
}

export function oneBotChannelKey(event: OneBotEvent): string {
  if (event.message_type === "private") return `onebot:${event.self_id}:private:${event.user_id}`;
  if (event.message_type === "group") return `onebot:${event.self_id}:group:${event.group_id}`;
  if (event.group_id !== undefined) return `onebot:${event.self_id}:group:${event.group_id}`;
  if (event.channel_id !== undefined) return `onebot:${event.self_id}:channel:${event.channel_id}`;
  return `onebot:${event.self_id}:unknown`;
}

export function mapOneBotPercept(event: OneBotEvent): OneBotPercept {
  const normalized = normalizeOneBotEvent(event);
  const data: Record<string, unknown> = {
    ...event,
    channelKey: oneBotChannelKey(event),
    segments: normalized.message,
  };
  if (event.post_type === "message") return { kind: "message-created", data };
  if (event.post_type === "message_sent") return { kind: "message-sent", data };
  if (event.post_type === "notice") return { kind: `notice.${event.notice_type ?? "event"}`, data };
  if (event.post_type === "request") return { kind: `request.${event.request_type ?? "event"}`, data };
  if (event.post_type === "meta_event") return { kind: `meta.${event.meta_event_type ?? "event"}`, data };
  return { kind: "onebot.event", data };
}
