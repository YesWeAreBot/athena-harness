import type { ModelMessage, ToolResultPart } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { createCheckpoint } from "../src/checkpoint.js";
import type { PruneOptions } from "../src/prune.js";
import type { SceneAddress } from "../src/scene.js";
import type { CompactionServices, RunnerFn } from "../src/turn-coordinator.js";
import { TurnCoordinator } from "../src/turn-coordinator.js";

function scene(channelId: string): SceneAddress {
  return { bodySid: "sandbox:alice", channelId };
}

function user(content: string): ModelMessage {
  return { role: "user", content };
}

interface RebuildFixture {
  readonly workspace: ModelMessage[];
  readonly coordinator: TurnCoordinator;
  readonly summaries: Array<{ history: readonly ModelMessage[]; lastFocusHistory: readonly ModelMessage[]; previousCompaction: string | null }>;
  readonly getCheckpoint: () => Checkpoint;
  readonly setLogicalFocus: (focus: SceneAddress | null) => void;
  readonly saved: () => Checkpoint | null;
}

function createRebuildFixture(
  options: { runner?: RunnerFn; save?: (checkpoint: Checkpoint) => Promise<void>; summarizeError?: Error; pruneOptions?: PruneOptions } = {},
): RebuildFixture {
  const workspace: ModelMessage[] = [];
  let checkpoint = createCheckpoint({
    focus: scene("general"),
    history: [user("old frame")],
    lastFocusHistory: [user("old transition")],
    compaction: "old memory",
  });
  let logicalFocus: SceneAddress | null = checkpoint.focus;
  let saved: Checkpoint | null = null;
  const summaries: RebuildFixture["summaries"] = [];
  const services = {
    summarize: async (request: Parameters<CompactionServices["summarize"]>[0]) => {
      summaries.push(request);
      if (options.summarizeError) throw options.summarizeError;
      return { compaction: "next memory" };
    },
    buildCheckpoint: async (compaction: string | null, frame: Parameters<CompactionServices["buildCheckpoint"]>[1]) =>
      createCheckpoint({ ...frame, compaction }),
    checkpointStore: {
      save: async (next: Checkpoint) => {
        if (options.save) {
          await options.save(next);
          return;
        }
        saved = next;
      },
    },
    getCheckpoint: () => checkpoint,
    setCheckpoint: (next: Checkpoint) => {
      checkpoint = next;
    },
    needsRebuild: () => checkpoint.focus?.channelId !== logicalFocus?.channelId,
    logicalFocus: () => logicalFocus,
    readFocusHistory: async (focus: SceneAddress) => [user(`archive:${focus.channelId}`)],
    promoteFocus: () => {},
    pruneOptions: options.pruneOptions,
    thresholdTokens: Number.MAX_SAFE_INTEGER,
  } as unknown as CompactionServices;
  const coordinator = new TurnCoordinator({ runner: options.runner, workspace, compaction: services });

  return {
    workspace,
    coordinator,
    summaries,
    getCheckpoint: () => checkpoint,
    setLogicalFocus: (focus) => {
      logicalFocus = focus;
    },
    saved: () => saved,
  };
}

describe("three-region rebuild", () => {
  it("prunes the workspace into the next frame and compacts the old frame only", async () => {
    const fixture = createRebuildFixture();
    fixture.workspace.push(
      user("keep current user"),
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "private" },
          { type: "text", text: "visible answer" },
          { type: "tool-call", toolCallId: "call-1", toolName: "lookup", input: { q: "x" } },
        ],
      },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "lookup", output: { type: "text", value: "result" } }] },
    );

    await fixture.coordinator.requestCompaction();

    expect(fixture.summaries).toHaveLength(1);
    expect(fixture.summaries[0]?.history).toEqual([user("old frame")]);
    expect(fixture.summaries[0]?.lastFocusHistory).toEqual([user("old transition")]);
    expect(fixture.workspace).toEqual([]);
    expect(fixture.saved()?.history).toEqual(expect.arrayContaining([user("keep current user")]));
    expect(JSON.stringify(fixture.saved()?.history)).toContain("visible answer");
    expect(JSON.stringify(fixture.saved()?.history)).toContain("lookup");
    expect(JSON.stringify(fixture.saved()?.history)).not.toContain("private");
    expect(fixture.saved()?.lastFocusHistory).toEqual([]);
  });

  it("forces a focus-switch rebuild below the token threshold and preserves the old workspace as a transition region", async () => {
    const fixture = createRebuildFixture({ runner: async (input, turnId) => ({ status: "completed", turnId, finishReason: "stop", delivered: false }) });
    fixture.setLogicalFocus(scene("other"));
    fixture.workspace.push(user("work before switch"));

    const admission = fixture.coordinator.submit({ messages: [], cause: "manual" });
    await admission.done;
    await fixture.coordinator.flush();

    expect(fixture.saved()?.focus).toEqual(scene("other"));
    expect(fixture.saved()?.history).toEqual([user("archive:other")]);
    expect(fixture.saved()?.lastFocusHistory).toEqual([user("work before switch")]);
    expect(fixture.workspace).toEqual([]);
  });

  it("does not clear workspace when checkpoint save fails", async () => {
    const fixture = createRebuildFixture({
      save: async () => {
        throw new Error("disk full");
      },
    });
    fixture.workspace.push(user("must survive"));
    const original = fixture.getCheckpoint();

    await expect(fixture.coordinator.requestCompaction()).rejects.toThrow("disk full");
    expect(fixture.workspace).toEqual([user("must survive")]);
    expect(fixture.getCheckpoint()).toEqual(original);
  });
  it("moves last-focus history into compaction on the next rebuild", async () => {
    const fixture = createRebuildFixture();
    fixture.setLogicalFocus(scene("other"));
    fixture.workspace.push(user("old focus work"));
    await fixture.coordinator.requestCompaction();

    fixture.workspace.push(user("new focus work"));
    await fixture.coordinator.requestCompaction();

    expect(fixture.summaries).toHaveLength(2);
    expect(fixture.summaries[1]?.history).toEqual([user("archive:other")]);
    expect(fixture.summaries[1]?.lastFocusHistory).toEqual([user("old focus work")]);
    expect(fixture.saved()?.history).toEqual([user("new focus work")]);
    expect(fixture.saved()?.lastFocusHistory).toEqual([]);
  });

  it("does not rebuild when focus returns to the checkpoint focus before turn completion", async () => {
    let finish!: () => void;
    const fixture = createRebuildFixture({
      runner: async (input, turnId) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return { status: "completed", turnId, finishReason: "stop", delivered: false };
      },
    });
    fixture.setLogicalFocus(scene("other"));
    const admission = fixture.coordinator.submit({ messages: [], cause: "manual" });
    fixture.setLogicalFocus(scene("general"));
    finish();
    await admission.done;
    await fixture.coordinator.flush();

    expect(fixture.summaries).toHaveLength(0);
    expect(fixture.saved()).toBeNull();
  });

  it("uses configured pruning thresholds when rebuilding the frame", async () => {
    const fixture = createRebuildFixture({ pruneOptions: { toolOutputMaxChars: 12, toolOutputHeadChars: 4, toolOutputTailChars: 4 } });
    const output: ToolResultPart["output"] = { type: "text", value: "BEGIN-0123456789-END" };
    fixture.workspace.push(
      { role: "assistant", content: [{ type: "tool-call", toolCallId: "call-1", toolName: "read_file", input: {} }] },
      { role: "tool", content: [{ type: "tool-result", toolCallId: "call-1", toolName: "read_file", output }] },
    );

    await fixture.coordinator.requestCompaction();

    const serialized = JSON.stringify(fixture.saved()?.history);
    expect(serialized).toContain("BEGI");
    expect(serialized).toContain("END");
    expect(serialized).toContain("…");
    expect(serialized).not.toContain("0123456789");
  });
  it("keeps the workspace and checkpoint when summarization fails", async () => {
    const fixture = createRebuildFixture({ summarizeError: new Error("model unavailable") });
    fixture.workspace.push(user("must survive summarizer failure"));
    const original = fixture.getCheckpoint();

    await expect(fixture.coordinator.requestCompaction()).rejects.toThrow("model unavailable");
    expect(fixture.workspace).toEqual([user("must survive summarizer failure")]);
    expect(fixture.getCheckpoint()).toEqual(original);
  });
});
