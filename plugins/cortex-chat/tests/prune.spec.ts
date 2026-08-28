import type { ModelMessage, ToolCallPart, ToolResultPart } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { prune } from "../src/prune.js";

function toolCall(toolCallId: string, toolName: string, input: unknown): ToolCallPart {
  return { type: "tool-call", toolCallId, toolName, input };
}

function toolResult(toolCallId: string, toolName: string, output: ToolResultPart["output"]): ToolResultPart {
  return { type: "tool-result", toolCallId, toolName, output };
}

describe("prune", () => {
  it("removes reasoning, pairs tool calls with results, and drops scene context deltas", () => {
    const workspace: ModelMessage[] = [
      { role: "user", content: "check this" },
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "private chain of thought" },
          toolCall("call-1", "peek_channel", { limit: 5 }),
          { type: "text", text: "I will check." },
        ],
      },
      { role: "tool", content: [toolResult("call-1", "peek_channel", { type: "text", value: "channel is quiet" })] },
      { role: "system", content: "<sceneContext><message>duplicated history</message></sceneContext>" },
      { role: "system", content: '<focusChange from="general" to="other">urgent</focusChange>' },
    ];

    const result = prune(workspace);
    const serialized = JSON.stringify(result);

    expect(serialized).not.toContain("private chain of thought");
    expect(serialized).not.toContain("sceneContext");
    expect(serialized).toContain("peek_channel");
    expect(serialized).toContain("channel is quiet");
    expect(serialized).toContain("<focusChange");
    expect(result.some((message) => message.role === "tool")).toBe(false);
    expect(result.some((message) => JSON.stringify(message).includes('"type":"tool-call"'))).toBe(false);
  });

  it("keeps failed tool output verbatim and trims only the middle of large success output", () => {
    const large = `BEGIN-${"x".repeat(2_000)}-END`;
    const workspace: ModelMessage[] = [
      { role: "assistant", content: [toolCall("ok", "read_file", { path: "a.txt" })] },
      { role: "tool", content: [toolResult("ok", "read_file", { type: "text", value: large })] },
      { role: "assistant", content: [toolCall("failed", "admin_action", {})] },
      { role: "tool", content: [toolResult("failed", "admin_action", { type: "error-text", value: "permission denied for user bob" })] },
      { role: "assistant", content: [toolCall("denied", "delete_file", {})] },
      { role: "tool", content: [toolResult("denied", "delete_file", { type: "execution-denied", reason: "approval was denied" })] },
    ];

    const serialized = JSON.stringify(prune(workspace));
    expect(serialized).toContain("BEGIN-");
    expect(serialized).toContain("-END");
    expect(serialized).toContain("…");
    expect(serialized).not.toContain("x".repeat(1_500));
    expect(serialized).toContain("permission denied for user bob");
    expect(serialized).toContain("approval was denied");
  });

  it("drops isolated tool calls and results and is idempotent", () => {
    const workspace: ModelMessage[] = [
      { role: "assistant", content: [toolCall("orphan-call", "missing_result", {})] },
      { role: "tool", content: [toolResult("orphan-result", "missing_call", { type: "text", value: "orphan" })] },
      { role: "user", content: "keep me" },
    ];

    const once = prune(workspace);
    expect(once).toEqual([{ role: "user", content: "keep me" }]);
    expect(prune(once)).toEqual(once);
  });
});
