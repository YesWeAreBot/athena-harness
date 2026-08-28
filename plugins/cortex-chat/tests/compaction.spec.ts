import type { ModelMessage } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { compactWorkspace, estimateTokens } from "../src/compaction.js";
import type { CompactionInput } from "../src/compaction.js";
import { recordingCompactModel } from "./ai-fixture.js";

function compactionInput(overrides: Partial<CompactionInput> = {}): CompactionInput {
  return {
    history: [{ role: "user", content: "new detail" }],
    lastFocusHistory: [],
    previousCompaction: null,
    model: recordingCompactModel("next memory"),
    ...overrides,
  };
}

describe("compactWorkspace", () => {
  it("produces one compaction entry from both frame regions and previous memory", async () => {
    const model = recordingCompactModel("next memory");
    const result = await compactWorkspace(
      compactionInput({
        model,
        lastFocusHistory: [{ role: "assistant", content: "unfinished promise" }],
        previousCompaction: "older memory",
      }),
    );

    expect(result).toEqual({ compaction: "next memory" });
    expect(model.prompts).toHaveLength(1);
    expect(model.prompt).toContain("older memory");
    expect(model.prompt).toContain("new detail");
    expect(model.prompt).toContain("unfinished promise");
    expect(model.prompt).toContain("<frame_history>");
    expect(model.prompt).toContain("<last_focus_history>");
  });

  it("does not call the model when both frame regions are empty", async () => {
    const model = recordingCompactModel("should not run");
    await expect(compactWorkspace({ history: [], lastFocusHistory: [], previousCompaction: "keep memory", model })).resolves.toEqual({
      compaction: "keep memory",
    });
    expect(model.prompts).toHaveLength(0);
  });

  it("keeps previous memory when the compaction model returns empty text", async () => {
    const model = recordingCompactModel("   ");
    await expect(compactWorkspace(compactionInput({ model, previousCompaction: "keep memory" }))).resolves.toEqual({ compaction: "keep memory" });
  });
});

describe("estimateTokens", () => {
  it("estimates native ModelMessage content without workspace metadata", () => {
    const messages: ModelMessage[] = [{ role: "user", content: "123456" }];
    expect(estimateTokens(messages)).toBe(5);
  });
});
