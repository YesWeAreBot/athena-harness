import { describe, expect, it } from "vitest";

import { createCheckpoint } from "../src/checkpoint.js";
import type { Frame } from "../src/checkpoint.js";
import type { StoredMessage } from "../src/message-store.js";
import { buildPromptSnapshot } from "../src/prompt.js";
import { renderAwarenessMessage, renderFrame, renderUserMessage } from "../src/render.js";
import type { SceneAddress } from "../src/scene.js";

function scene(bodySid: string, channelId: string): SceneAddress {
  return { bodySid, channelId };
}

function stored(content: string, overrides: Partial<StoredMessage> = {}): StoredMessage {
  return {
    bodySid: "sandbox:alice",
    channelId: "general",
    messageId: "m1",
    userId: "u1",
    userName: "Alice",
    content,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function frame(): Frame {
  return {
    focus: scene("sandbox:alice", "general"),
    history: [{ role: "user", content: "recent history" }],
    lastFocusHistory: [{ role: "assistant", content: "unfinished promise" }],
  };
}

describe("workspace message rendering", () => {
  it("renders user metadata in a deterministic tagged message", () => {
    const result = renderUserMessage(stored("hello <world> & friends"));
    expect(result.role).toBe("user");
    expect(result.content).toMatch(/^<message from="u1" scene="sandbox:alice\/general" ts="\d{2}:\d{2}" id="m1">hello &lt;world&gt; &amp; friends<\/message>$/);
  });

  it("renders awareness with source, trigger, content, and context", () => {
    const result = renderAwarenessMessage({
      message: stored("ping <now>"),
      trigger: "mention",
      context: [stored("before", { messageId: "m0", timestamp: 1_699_999_999_000 })],
      reason: "A user explicitly mentioned the Life.",
      suggestion: "Use peek_channel before changing focus.",
    });

    expect(result.role).toBe("user");
    expect(result.content).toContain('<awareness source="sandbox:alice/general" trigger="mention" from="u1" scene="sandbox:alice/general"');
    expect(result.content).toContain("ping &lt;now&gt;");
    expect(result.content).toContain('id="m0"');
    expect(result.content).toContain("A user explicitly mentioned the Life.");
    expect(result.content).toContain("Use peek_channel before changing focus.");
  });
});

describe("frame projection", () => {
  it("renders the structured frame without awareness or global-state blocks", () => {
    const first = renderFrame(frame());
    const second = renderFrame(frame());
    const serialized = JSON.stringify(first);

    expect(serialized).toContain("sandbox:alice");
    expect(serialized).toContain("recent history");
    expect(serialized).toContain("unfinished promise");
    expect(serialized).toContain("<last_focus_history>");
    expect(serialized).not.toContain("<awareness>");
    expect(serialized).not.toContain("<globalState>");
    expect(first).toEqual(second);
  });

  it("uses checkpoint Frame fields directly and keeps the stable prefix separate", () => {
    const checkpoint = createCheckpoint({ ...frame(), compaction: "memory" });
    const snapshot = buildPromptSnapshot({ persona: "Alice", compaction: checkpoint.compaction }, checkpoint);

    expect(snapshot.stableMessages.map((message) => message.content).join("\n")).toContain("memory");
    expect(JSON.stringify(snapshot.frameMessages)).toContain("recent history");
    expect(JSON.stringify(snapshot.frameMessages)).toContain("unfinished promise");
    expect(Object.keys(snapshot).sort()).toEqual(["frameMessages", "stableMessages"]);
  });
});
