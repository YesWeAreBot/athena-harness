import type { UserModelMessage } from "@athena-ai/core";
import type { IMMessageEvent } from "@athena-ai/protocol-im";
import { Element } from "@cordisjs/element";
import { describe, expect, it } from "vitest";

import { Attention, type AttentionObservation } from "../src/attention.js";
import type { MessageStore, StoredMessage } from "../src/message-store.js";
import type { SceneAddress } from "../src/scene.js";
import { shouldTrigger } from "../src/trigger.js";

function scene(bodySid: string, channelId: string): SceneAddress {
  return { bodySid, channelId };
}

let seq = 0;
function stored(content: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    bodySid: "sandbox:alice",
    channelId: "general",
    messageId: `m${++seq}`,
    userId: "u1",
    content,
    timestamp: 100 + seq,
    ...overrides,
  };
}

function fakeStore(history: readonly StoredMessage[] = []) {
  return {
    readScene: async () => history,
    store: async () => {},
    storeEvent: async () => stored("hi"),
  } as unknown as MessageStore;
}

function observation(opts: {
  bodySid: string;
  channelId: string;
  isDirect?: boolean;
  content?: string;
  selfId?: string;
  elements?: readonly Element[];
}): AttentionObservation {
  const bodySid = opts.bodySid;
  const channelId = opts.channelId;
  const isDirect = opts.isDirect ?? false;
  const content = opts.content ?? "hello";
  const selfId = opts.selfId ?? "me";
  const elements = opts.elements ?? [];
  const s = stored(content, { bodySid, channelId });
  const event = {
    type: "message-created",
    body: { sid: bodySid } as unknown as never,
    channelId,
    channel: { id: channelId } as unknown as never,
    userId: s.userId,
    selfId,
    isDirect,
    elements: [...elements] as unknown as never,
    content,
    messageId: s.messageId,
    message: { id: s.messageId, content } as unknown as never,
    timestamp: s.timestamp,
  } as unknown as IMMessageEvent;
  const message: UserModelMessage = { role: "user", content };
  return { event, stored: s, message };
}

describe("Attention routing", () => {
  it("adopts the first trigger Scene as both frame and logical focus", async () => {
    const attention = new Attention({ store: fakeStore(), initialFocus: null });
    const result = await attention.route(observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: true }));
    expect(result.kind).toBe("trigger");
    expect(attention.snapshot()).toMatchObject({ frameFocus: scene("sandbox:alice", "general"), logicalFocus: scene("sandbox:alice", "general") });
  });

  it("routes a focus non-trigger message to workspace background", async () => {
    const attention = new Attention({ store: fakeStore(), initialFocus: scene("sandbox:alice", "general") });
    await expect(attention.route(observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: false }))).resolves.toMatchObject({
      kind: "background",
    });
  });

  it("notifies the frame owner when the first trigger adopts a focus", async () => {
    let adopted: SceneAddress | null = null;
    const attention = new Attention({
      store: fakeStore(),
      initialFocus: null,
      onColdStart: (focus) => {
        adopted = focus;
      },
    });
    await attention.route(observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: true }));
    expect(adopted).toEqual(scene("sandbox:alice", "general"));
  });

  it("renders a non-focus trigger as an awareness workspace message without accumulator state", async () => {
    const source = stored("earlier", { channelId: "other", messageId: "m0", timestamp: 90 });
    const attention = new Attention({ store: fakeStore([source]), initialFocus: scene("sandbox:alice", "general") });
    const result = await attention.route(observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true, content: "ping" }));
    expect(result.kind).toBe("awareness");
    expect(result.kind === "awareness" ? result.messages[0]?.content : "").toContain("<awareness");
    expect(result.kind === "awareness" ? result.messages[0]?.content : "").toContain("earlier");
    expect(attention.snapshot()).not.toHaveProperty("awareness");
  });

  it("switchFocus changes logical focus only", async () => {
    const attention = new Attention({ store: fakeStore(), initialFocus: scene("sandbox:alice", "general") });
    const from = scene("sandbox:alice", "general");
    const to = scene("sandbox:alice", "other");
    const res = attention.switchFocus(to);
    expect(res.from).toEqual(from);
    expect(res.to).toEqual(to);
    expect(attention.snapshot().logicalFocus).toEqual(to);
    expect(attention.snapshot().frameFocus).toEqual(from);
  });

  it("non-focus non-trigger is ignored", async () => {
    const attention = new Attention({ store: fakeStore(), initialFocus: scene("sandbox:alice", "general") });
    const result = await attention.route(observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: false }));
    expect(result.kind).toBe("ignore");
  });
});

describe("shouldTrigger", () => {
  it("direct triggers", () => {
    const obs = observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: true });
    expect(shouldTrigger(obs.event)).toBe(true);
  });

  it("@self triggers", () => {
    const obs = observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: false, elements: [Element("at", { id: "me" })] });
    expect(shouldTrigger(obs.event)).toBe(true);
  });

  it("otherwise not", () => {
    const obs = observation({ bodySid: "sandbox:alice", channelId: "general", isDirect: false });
    expect(shouldTrigger(obs.event)).toBe(false);
  });
});
