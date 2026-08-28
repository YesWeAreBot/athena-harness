import type { AssistantModelMessage, ModelMessage, ToolCallPart, ToolModelMessage, ToolResultPart } from "@athena-ai/core";

export type ToolResultOutput = ToolResultPart["output"];

export const DEFAULT_TOOL_OUTPUT_MAX_CHARS = 1_000;
export const DEFAULT_TOOL_OUTPUT_HEAD_CHARS = 400;
export const DEFAULT_TOOL_OUTPUT_TAIL_CHARS = 400;
const ELLIPSIS = "…";

type AssistantPart = Exclude<AssistantModelMessage["content"], string>[number];
type AssistantTextPart = Extract<AssistantPart, { type: "text" }>;
type AssistantToolCallPart = Extract<AssistantPart, { type: "tool-call" }>;
type ToolResultContentPart = Extract<ToolModelMessage["content"][number], { type: "tool-result" }>;

export interface PruneOptions {
  readonly toolOutputMaxChars?: number;
  readonly toolOutputHeadChars?: number;
  readonly toolOutputTailChars?: number;
}

interface ResolvedPruneOptions {
  readonly toolOutputMaxChars: number;
  readonly toolOutputHeadChars: number;
  readonly toolOutputTailChars: number;
}

function resolveOptions(options: PruneOptions): ResolvedPruneOptions {
  return {
    toolOutputMaxChars: Math.max(ELLIPSIS.length + 2, options.toolOutputMaxChars ?? DEFAULT_TOOL_OUTPUT_MAX_CHARS),
    toolOutputHeadChars: Math.max(0, options.toolOutputHeadChars ?? DEFAULT_TOOL_OUTPUT_HEAD_CHARS),
    toolOutputTailChars: Math.max(0, options.toolOutputTailChars ?? DEFAULT_TOOL_OUTPUT_TAIL_CHARS),
  };
}

function isSceneContext(message: ModelMessage): boolean {
  return message.role === "system" && typeof message.content === "string" && /^\s*<sceneContext(?:\s|>)/i.test(message.content);
}

function isToolCallPart(part: AssistantPart): part is AssistantToolCallPart {
  return part.type === "tool-call";
}

function isToolResultPart(message: ModelMessage): message is ToolModelMessage {
  return message.role === "tool";
}

function collectToolResults(workspace: readonly ModelMessage[]): Map<string, ToolResultContentPart> {
  const results = new Map<string, ToolResultContentPart>();
  for (const message of workspace) {
    if (!isToolResultPart(message)) continue;
    for (const part of message.content) {
      if (part.type === "tool-result") results.set(part.toolCallId, part);
    }
  }
  return results;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const result = JSON.stringify(value);
    return result === undefined ? String(value) : result;
  } catch {
    return String(value);
  }
}

function truncate(text: string, options: ResolvedPruneOptions): string {
  if (text.length <= options.toolOutputMaxChars) return text;
  const available = Math.max(0, options.toolOutputMaxChars - ELLIPSIS.length);
  let head = Math.min(options.toolOutputHeadChars, available);
  let tail = Math.min(options.toolOutputTailChars, available - head);
  if (head + tail < available) {
    tail = Math.min(options.toolOutputTailChars + available - head - tail, available - head);
  }
  if (head + tail < available) head = Math.min(options.toolOutputHeadChars + available - head - tail, available - tail);
  return `${text.slice(0, head)}${ELLIPSIS}${text.slice(text.length - tail)}`;
}

function contentText(value: Extract<ToolResultOutput, { type: "content" }>["value"]): string {
  return value
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "file") return `[file ${part.mediaType}]`;
      return `[${part.type}]`;
    })
    .join("\n");
}

function summarizeOutput(output: ToolResultOutput, options: ResolvedPruneOptions): string {
  if (output.type === "error-text") return output.value;
  if (output.type === "execution-denied") return output.reason ?? "tool execution denied";
  if (output.type === "error-json") return stringify(output.value);

  const value = output.type === "text" ? output.value : output.type === "content" ? contentText(output.value) : stringify(output.value);
  return truncate(value, options);
}

function toolSummary(call: ToolCallPart, result: ToolResultContentPart, options: ResolvedPruneOptions): ModelMessage {
  return {
    role: "system",
    content: `[tool] ${call.toolName}(${stringify(call.input)}) → ${summarizeOutput(result.output, options)}`,
  };
}

function assistantTextMessage(message: AssistantModelMessage, parts: readonly AssistantTextPart[]): ModelMessage | null {
  if (parts.length === 0) return null;
  return {
    role: "assistant",
    content: [...parts],
    ...(message.providerOptions === undefined ? {} : { providerOptions: message.providerOptions }),
  };
}

function pruneAssistant(message: AssistantModelMessage, results: ReadonlyMap<string, ToolResultContentPart>, options: ResolvedPruneOptions): ModelMessage[] {
  if (typeof message.content === "string") return [message];

  const textParts: AssistantTextPart[] = [];
  const toolCalls: AssistantToolCallPart[] = [];
  for (const part of message.content) {
    if (part.type === "text") textParts.push(part);
    else if (isToolCallPart(part)) toolCalls.push(part);
  }

  const output: ModelMessage[] = [];
  const textMessage = assistantTextMessage(message, textParts);
  if (textMessage) output.push(textMessage);
  for (const call of toolCalls) {
    const result = results.get(call.toolCallId);
    if (result) output.push(toolSummary(call, result, options));
  }
  return output;
}

/**
 * Converts the ephemeral workspace into a compact, provider-safe frame history.
 * Tool calls are emitted only when their matching tool result exists.
 */
export function prune(workspace: readonly ModelMessage[], options: PruneOptions = {}): ModelMessage[] {
  const resolved = resolveOptions(options);
  const results = collectToolResults(workspace);
  const output: ModelMessage[] = [];

  for (const message of workspace) {
    if (isSceneContext(message)) continue;
    if (message.role === "assistant") {
      output.push(...pruneAssistant(message, results, resolved));
      continue;
    }
    if (message.role === "tool") continue;
    output.push(message);
  }

  return output;
}
