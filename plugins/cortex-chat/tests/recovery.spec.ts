import { readFileSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CheckpointStore, createCheckpoint } from "../src/checkpoint.js";
import type { SceneAddress } from "../src/scene.js";
import { recordingCompactModel, scriptedModel } from "./ai-fixture.js";
import type { CompactModel } from "./ai-fixture.js";
import { createHarness, waitFor } from "./im-fixture.js";
import type { LifeHarness } from "./im-fixture.js";

const BODY_SID = "onebot:100";
const DIRECT = "@u1";

function scene(channelId: string): SceneAddress {
  return { bodySid: BODY_SID, channelId };
}

function checkpointPath(dataDir: string): string {
  return path.join(dataDir, "cortex-chat", "checkpoint.json");
}

function workspaceUser(content: string) {
  return { role: "user" as const, content };
}

/** A Life whose Body is registered but whose Cortex is not installed yet. */
async function createLife(models: { chat?: unknown; compact?: CompactModel } = {}): Promise<{ life: LifeHarness; body: ReturnType<LifeHarness["body"]> }> {
  const chat = models.chat ?? scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "nothing to do" } }]);
  const registry = { alice: chat, compact: models.compact ?? recordingCompactModel("summary") } as Parameters<typeof createHarness>[0];
  const harness = await createHarness(registry);
  const life = await harness.life("alice");
  return { life, body: life.body("onebot", "100") };
}

describe("restart recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("restores the durable checkpoint and starts with an empty workspace", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "caught up" } }]);
    const { life, body } = await createLife({ chat: model });

    await new CheckpointStore(life.ctx).save(
      createCheckpoint({
        focus: scene(DIRECT),
        history: [{ role: "user", content: "frozen frame" }],
        lastFocusHistory: [{ role: "assistant", content: "old transition" }],
        compaction: "persisted global summary",
      }),
    );

    const { cortex, dispose } = await life.install();
    expect(cortex.attention.snapshot()).toMatchObject({ frameFocus: scene(DIRECT), logicalFocus: scene(DIRECT) });
    expect(cortex.workspace).toEqual([]);

    body.receive({ channelId: DIRECT, content: "still there?", messageId: "in-1" });
    await waitFor(() => expect(model.calls).toHaveLength(1));
    const prompt = JSON.stringify(model.calls[0]?.prompt);
    expect(prompt).toContain("persisted global summary");
    await cortex.messages.store({
      bodySid: BODY_SID,
      channelId: DIRECT,
      messageId: "archive-only",
      userId: "u2",
      content: "newer archive only",
      timestamp: Date.now(),
    });
    expect(prompt).toContain("frozen frame");
    expect(prompt).not.toContain("newer archive only");
    expect(cortex.workspace.some((message) => message.role === "user" && String(message.content).includes("still there?"))).toBe(true);

    await dispose();
  });
  it("starts cold without any ephemeral workspace state", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "ok" } }]);
    const { life, body } = await createLife({ chat: model });
    const { cortex, dispose } = await life.install();

    expect(cortex.attention.snapshot().frameFocus).toBeNull();
    expect(cortex.workspace).toEqual([]);
    body.receive({ channelId: DIRECT, content: "hello again", messageId: "in-1" });
    await waitFor(() => expect(model.calls).toHaveLength(1));
    expect(cortex.attention.snapshot().frameFocus).toEqual(scene(DIRECT));
    expect(cortex.workspace.some((message) => message.role === "user" && String(message.content).includes("hello again"))).toBe(true);

    await dispose();
  });

  it("starts with an empty checkpoint and keeps a corrupt one on disk", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "ok" } }]);
    const { life, body } = await createLife({ chat: model });
    const file = checkpointPath(life.dataDir);
    await mkdir(path.dirname(file), { recursive: true });
    writeFileSync(file, "{ this is not json", "utf8");

    const { cortex, dispose } = await life.install();
    expect(cortex.attention.snapshot().frameFocus).toBeNull();
    body.receive({ channelId: DIRECT, content: "are you up?", messageId: "in-1" });
    await waitFor(async () => expect(await cortex.messages.readScene(scene(DIRECT))).toHaveLength(1));
    expect(readFileSync(file, "utf8")).toBe("{ this is not json");

    await dispose();
  });
});

describe("checkpoint transition recovery", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the in-memory workspace and old checkpoint when checkpoint save fails", async () => {
    const compact = recordingCompactModel("global summary");
    const { life } = await createLife({ compact });
    await new CheckpointStore(life.ctx).save(
      createCheckpoint({
        focus: scene(DIRECT),
        history: [{ role: "user", content: "old frame" }],
        lastFocusHistory: [],
        compaction: "old memory",
      }),
    );
    const { cortex, dispose } = await life.install({ compactModel: "scripted:compact" });
    cortex.workspace.push(workspaceUser("promised to check the config"));

    vi.spyOn(CheckpointStore.prototype, "save").mockRejectedValueOnce(new Error("disk full"));
    await expect(cortex.coordinator.requestCompaction()).rejects.toThrow(/disk full/);
    expect(cortex.workspace).toEqual([{ role: "user", content: "promised to check the config" }]);
    expect(await cortex.checkpointStore.load()).toMatchObject({ compaction: "old memory", history: [{ content: "old frame" }] });

    await cortex.coordinator.requestCompaction();
    expect(cortex.workspace).toEqual([]);
    expect(await cortex.checkpointStore.load()).toMatchObject({ compaction: "global summary" });
    expect(compact.prompts).toHaveLength(2);

    await dispose();
  });
});
