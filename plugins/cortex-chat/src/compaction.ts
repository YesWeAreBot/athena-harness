import { generateText } from "@athena-ai/core";
import type { AssistantModelMessage, LanguageModel, ModelMessage, ToolModelMessage, UserModelMessage } from "@athena-ai/core";

// ─── Contract ────────────────────────────────────────────────────────────────

export interface CompactionInput {
  readonly history: readonly ModelMessage[];
  readonly lastFocusHistory: readonly ModelMessage[];
  readonly previousCompaction: string | null;
  readonly model: LanguageModel;
}

export interface CompactionResult {
  readonly compaction: string;
}

/** What the `TurnCoordinator` hands to its summarizer; it owns the model choice. */
export type SummarizeRequest = Omit<CompactionInput, "model">;

// ─── Transcript ──────────────────────────────────────────────────────────────

function renderUserContent(content: UserModelMessage["content"]): string[] {
  if (typeof content === "string") return [`[user] ${content}`];
  const lines: string[] = [];
  for (const part of content) {
    if (part.type === "text") lines.push(`[user] ${part.text}`);
    else if (part.type === "file") lines.push(`[user file] ${part.mediaType}`);
  }
  return lines;
}

function renderAssistantContent(content: AssistantModelMessage["content"]): string[] {
  if (typeof content === "string") return [`[assistant] ${content}`];
  const lines: string[] = [];
  for (const part of content) {
    switch (part.type) {
      case "text":
        lines.push(`[assistant] ${part.text}`);
        break;
      case "reasoning":
        lines.push(`[reasoning] ${part.text}`);
        break;
      case "tool-call":
        lines.push(`[tool_call] ${part.toolName} ${JSON.stringify(part.input)}`);
        break;
      case "tool-result":
        lines.push(`[tool_result] ${part.toolName} ${JSON.stringify(part.output)}`);
        break;
      case "file":
        lines.push(`[assistant file] ${part.mediaType}`);
        break;
      default:
        break;
    }
  }
  return lines;
}

function renderToolContent(content: ToolModelMessage["content"]): string[] {
  const lines: string[] = [];
  for (const part of content) {
    if (part.type === "tool-approval-response") {
      lines.push(`[tool_approval] ${part.approved ? "granted" : "denied"}${part.reason === undefined ? "" : `: ${part.reason}`}`);
      continue;
    }
    const output = part.output;
    if (output.type === "error-text") lines.push(`[tool_error] ${part.toolName}: ${output.value}`);
    else if (output.type === "text") lines.push(`[tool_result] ${part.toolName} ${output.value}`);
    else if (output.type === "execution-denied") lines.push(`[tool_denied] ${part.toolName}${output.reason === undefined ? "" : `: ${output.reason}`}`);
    else lines.push(`[tool_result] ${part.toolName} ${JSON.stringify(output.value)}`);
  }
  return lines;
}

function renderMessage(message: ModelMessage): string[] {
  if (message.role === "system") return [`[system] ${message.content}`];
  if (message.role === "user") return renderUserContent(message.content);
  if (message.role === "assistant") return renderAssistantContent(message.content);
  return renderToolContent(message.content);
}

function renderMessages(messages: readonly ModelMessage[]): string {
  return messages.flatMap(renderMessage).join("\n");
}

export function estimateTokens(messages: readonly ModelMessage[]): number {
  return Math.ceil(renderMessages(messages).length / 3);
}

// ─── Prompt ─────────────────────────────────────────────────────────────────

const GLOBAL_SYSTEM = [
  "你正在压缩一个数字生命主心智的工作记忆。把当前帧区和上一版压缩条目浓缩为下一次 checkpoint 使用的记忆条目。",
  "",
  "输入区的含义：",
  "- frame_history 是较新的客观消息与认知记录，细节程度高于上一版压缩条目。",
  "- last_focus_history 是切换 focus 前一代被剪枝的认知轨迹；保留其中跨 focus 的决策、承诺和未完成事项。",
  "- previous_memory 是更早的压缩内容；在不丢失重要事实的前提下平滑更新它。",
  "",
  "保留：",
  "- 跨 focus 的决策与理由",
  "- 已经作出但尚未完成的承诺",
  "- 与他人形成的关系判断与态度变化",
  "- 影响后续行为的重要事实与偏好",
  "- 仍在等待回应的对话线索",
  "- 工具调用失败的原因与目标（谁、哪个频道、什么错误）",
  "",
  "不保留：",
  "- 可以从消息档案恢复的原始消息内容",
  "- 成功工具调用的参数与完整返回值",
  "- 已经彻底结束且无后续影响的事务",
  "- 时间戳与消息 ID",
  "",
  "输出格式：直接输出记忆条目，无标题无前缀，每条以 · 开头，一行一条。",
  '如果没有值得记住的内容，输出"(无新记忆)"。',
].join("\n");

function compactionPrompt(input: CompactionInput): string {
  return [
    "<previous_memory>",
    input.previousCompaction ?? "(无)",
    "</previous_memory>",
    "",
    "<frame_history>",
    renderMessages(input.history) || "(无)",
    "</frame_history>",
    "",
    "<last_focus_history>",
    renderMessages(input.lastFocusHistory) || "(无)",
    "</last_focus_history>",
  ].join("\n");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

/** Produce one global compaction entry from the two frame regions and older memory. */
export async function compactWorkspace(input: CompactionInput): Promise<CompactionResult> {
  if (input.history.length === 0 && input.lastFocusHistory.length === 0) {
    return { compaction: input.previousCompaction ?? "" };
  }

  const result = await generateText({
    model: input.model,
    system: GLOBAL_SYSTEM,
    prompt: compactionPrompt(input),
  });
  const text = result.text.trim();
  return { compaction: text.length > 0 ? text : (input.previousCompaction ?? "") };
}
