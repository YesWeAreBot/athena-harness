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

function fakeStore(history: StoredMessage[] = []) {
  return {
    readScene: async (_scene: unknown, opts?: { after?: { timestamp: number; messageId: string }; limit?: number }) => {
      let filtered = [...history];
      if (opts?.after) {
        const { timestamp, messageId } = opts.after;
        filtered = filtered.filter((m) => m.timestamp > timestamp || (m.timestamp === timestamp && m.messageId > messageId));
      }
      filtered.sort((a, b) => a.timestamp - b.timestamp || a.messageId.localeCompare(b.messageId));
      if (opts?.limit !== undefined && filtered.length > opts.limit) {
        filtered = filtered.slice(filtered.length - opts.limit);
      }
      return filtered;
    },
    store: async () => {},
    storeEvent: async () => stored("hi"),
    push(msg: StoredMessage) {
      history.push(msg);
    },
  } as unknown as MessageStore & { push(msg: StoredMessage): void };
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

  it("second awareness for the same scene delivers only incremental context", async () => {
    // Use timestamps far apart so the trigger (auto-generated ~100+seq) doesn't interfere.
    // The cursor is set to the trigger message, so the next readScene(after: trigger) skips everything at or before it.
    const m1 = stored("first", { channelId: "other", bodySid: "sandbox:alice", messageId: "c1", timestamp: 10 });
    const m2 = stored("second", { channelId: "other", bodySid: "sandbox:alice", messageId: "c2", timestamp: 20 });
    const store = fakeStore([m1, m2]);
    const attention = new Attention({ store, initialFocus: scene("sandbox:alice", "general"), awarenessHistoryLimit: 5 });

    // First awareness: should include m1, m2 as context
    const obs1 = observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true, content: "ping1" });
    const r1 = await attention.route(obs1);
    expect(r1.kind).toBe("awareness");
    const content1 = r1.kind === "awareness" ? r1.messages[0]!.content : "";
    expect(content1).toContain("first");
    expect(content1).toContain("second");

    // Add m3 with a timestamp after the trigger message's auto-generated timestamp
    const m3 = stored("third", { channelId: "other", bodySid: "sandbox:alice", messageId: "c3", timestamp: 90_000 });
    store.push(m3);

    // Second awareness: should only include m3 (incremental), not m1 or m2
    const obs2 = observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true, content: "ping2" });
    const r2 = await attention.route(obs2);
    expect(r2.kind).toBe("awareness");
    const content2 = r2.kind === "awareness" ? r2.messages[0]!.content : "";
    expect(content2).toContain("third");
    expect(content2).not.toContain("first");
    expect(content2).not.toContain("second");
  });

  it("resetAwarenessCursors causes the next awareness to deliver a full window again", async () => {
    const m1 = stored("old", { channelId: "other", bodySid: "sandbox:alice", messageId: "c1", timestamp: 100 });
    const store = fakeStore([m1]);
    const attention = new Attention({ store, initialFocus: scene("sandbox:alice", "general"), awarenessHistoryLimit: 5 });

    // First awareness — establishes the cursor
    await attention.route(observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true, content: "a" }));

    // Reset (as compaction would)
    attention.resetAwarenessCursors();

    // Next awareness should deliver m1 again as full context
    const m2 = stored("new", { channelId: "other", bodySid: "sandbox:alice", messageId: "c2", timestamp: 200 });
    store.push(m2);
    const obs = observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true, content: "b" });
    const r = await attention.route(obs);
    expect(r.kind).toBe("awareness");
    const content = r.kind === "awareness" ? r.messages[0]!.content : "";
    expect(content).toContain("old");
    expect(content).toContain("new");
  });

  it("awareness with awarenessHistoryLimit=0 produces no context", async () => {
    const m1 = stored("ctx", { channelId: "other", bodySid: "sandbox:alice", messageId: "c1", timestamp: 100 });
    const attention = new Attention({ store: fakeStore([m1]), initialFocus: scene("sandbox:alice", "general"), awarenessHistoryLimit: 0 });
    const result = await attention.route(observation({ bodySid: "sandbox:alice", channelId: "other", isDirect: true }));
    expect(result.kind).toBe("awareness");
    const content = result.kind === "awareness" ? result.messages[0]!.content : "";
    expect(content).toContain("(no context)");
    expect(content).not.toContain("ctx");
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
