import { describe, expect, it } from "vitest";

import { mapOneBotPercept, normalizeMessageSegments, normalizeOneBotEvent, oneBotChannelKey, parseOneBotEvent } from "../src/index.js";

describe("onebot mapping", () => {
  it("parses only object events with post_type", () => {
    expect(parseOneBotEvent({ post_type: "message" }).post_type).toBe("message");
    expect(() => parseOneBotEvent(null)).toThrow(/object/);
    expect(() => parseOneBotEvent({})).toThrow(/post_type/);
  });

  it("normalizes OneBot fields and message segments", () => {
    const normalized = normalizeOneBotEvent({
      post_type: "message",
      self_id: 123,
      message_type: "private",
      message_id: 1,
      user_id: 456,
      raw_message: "hello",
      message: [{ type: "text", data: { text: "hello" } }],
    });

    expect(normalized).toMatchObject({
      postType: "message",
      selfId: "123",
      messageType: "private",
      messageId: "1",
      userId: "456",
      rawMessage: "hello",
    });
    expect(normalized.message).toEqual([{ type: "text", data: { text: "hello" } }]);
  });

  it("maps string messages to text segments", () => {
    expect(normalizeMessageSegments("hello")).toEqual([{ type: "text", data: { text: "hello" } }]);
  });

  it("builds stable channel keys", () => {
    expect(
      oneBotChannelKey({
        post_type: "message",
        self_id: 1,
        message_type: "private",
        user_id: 2,
      }),
    ).toBe("onebot:1:private:2");
    expect(
      oneBotChannelKey({
        post_type: "message",
        self_id: 1,
        message_type: "group",
        group_id: 2,
      }),
    ).toBe("onebot:1:group:2");
  });

  it("maps event post types to percept kinds", () => {
    expect(mapOneBotPercept({ post_type: "message" }).kind).toBe("message-created");
    expect(mapOneBotPercept({ post_type: "message_sent" }).kind).toBe("message-sent");
    expect(mapOneBotPercept({ post_type: "notice", notice_type: "poke" }).kind).toBe("notice.poke");
    expect(mapOneBotPercept({ post_type: "request", request_type: "friend" }).kind).toBe("request.friend");
    expect(mapOneBotPercept({ post_type: "meta_event", meta_event_type: "heartbeat" }).kind).toBe("meta.heartbeat");
    expect(mapOneBotPercept({ post_type: "unknown" }).kind).toBe("onebot.event");
  });
});
