import { isAtSelf } from "@athena-ai/protocol-im";
import { Element } from "@cordisjs/element";
import { describe, expect, it } from "vitest";

import { Attention } from "../src/attention.js";
import { buildFrameMessage, buildSystemMessages, CONSTITUTION } from "../src/prompt.js";
import { shouldTrigger } from "../src/trigger.js";

function ev(overrides: Record<string, unknown> = {}) {
  const base = {
    platform: "test",
    channelId: "c1",
    userId: "u1",
    selfId: "me",
    content: "hello",
    isDirect: false,
    elements: [] as Element[],
  };
  return { ...base, ...overrides } as never;
}

describe("isAtSelf", () => {
  it("detects at=self", () => {
    expect(isAtSelf({ elements: [Element("at", { id: "me" })], selfId: "me" })).toBe(true);
  });
  it("ignores other ids", () => {
    expect(isAtSelf({ elements: [Element("at", { id: "other" })], selfId: "me" })).toBe(false);
  });
  it("false when no selfId", () => {
    expect(isAtSelf({ elements: [Element("at", { id: "me" })] })).toBe(false);
  });
});

describe("shouldTrigger", () => {
  it("direct triggers", () => expect(shouldTrigger(ev({ isDirect: true }))).toBe(true));
  it("@self triggers", () => expect(shouldTrigger(ev({ elements: [Element("at", { id: "me" })] }))).toBe(true));
  it("otherwise not", () => expect(shouldTrigger(ev())).toBe(false));
});

describe("Attention routing", () => {
  it("cold-start: first trigger adopts focus", async () => {
    const att = new Attention({ store: { getByChannel: async () => [] } as never, initialFocus: null });
    const r = await att.route(ev({ content: "hi", isDirect: true }));
    expect(r.kind).toBe("trigger");
    expect(att.snapshot().focusSceneId).toBe("test:c1");
  });

  it("focus trigger → trigger", async () => {
    const att = new Attention({ store: { getByChannel: async () => [] } as never, initialFocus: "test:c1" });
    const r = await att.route(ev({ isDirect: true }));
    expect(r.kind).toBe("trigger");
  });

  it("focus non-trigger → background", async () => {
    const att = new Attention({ store: { getByChannel: async () => [] } as never, initialFocus: "test:c1" });
    const r = await att.route(ev());
    expect(r.kind).toBe("background");
  });

  it("non-focus trigger → awareness", async () => {
    const att = new Attention({ store: { getByChannel: async () => [] } as never, initialFocus: "test:other" });
    const r = await att.route(ev({ isDirect: true, content: "ping me" }));
    expect(r.kind).toBe("awareness");
    expect((r as { messages: Array<{ content: string }> }).messages[0].content).toContain("[awareness");
  });

  it("non-focus non-trigger → ignore", async () => {
    const att = new Attention({ store: { getByChannel: async () => [] } as never, initialFocus: "test:other" });
    const r = await att.route(ev());
    expect(r.kind).toBe("ignore");
  });
});

describe("prompt", () => {
  it("constitution is non-empty", () => expect(CONSTITUTION.length).toBeGreaterThan(100));

  it("system messages include persona and compaction", () => {
    const sys = buildSystemMessages({ persona: "you are alice", compaction: "mem: foo" });
    expect(sys).toHaveLength(3);
    expect(JSON.stringify(sys[1])).toContain("alice");
    expect(JSON.stringify(sys[2])).toContain("mem: foo");
  });

  it("frame message contains focus and history", () => {
    const frame = buildFrameMessage({
      focusChannelId: "c1",
      focusPlatform: "test",
      history: [{ platform: "test", id: "m1", channelId: "c1", userId: "u1", content: "hi", timestamp: Date.now() }],
      awarenessLines: ["(无待处理事项)"],
    });
    expect(JSON.stringify(frame)).toContain("c1");
    expect(JSON.stringify(frame)).toContain("hi");
  });
});
