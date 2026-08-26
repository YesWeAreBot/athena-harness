import { generateText, type LanguageModel } from "@athena-ai/core";

import type { WsMessage } from "./workspace-store.js";

// ─── Config ──────────────────────────────────────────────────────────────────

export interface CompactionConfig {
  thresholdTokens?: number; // default 8000
  idleMs?: number; // default 300_000
  model?: LanguageModel;
  persona?: string;
  personaName?: string;
}

// ─── Extraction ──────────────────────────────────────────────────────────────

/** Content part shape from AI SDK ModelMessage */
interface TextPart {
  type?: string;
  text?: string;
  content?: string;
}

type MessageContent = string | TextPart[];

/* oxlint-disable anti-slop(no-runtime-typeof) -- parsing polymorphic AI SDK content shape at I/O boundary */
function textContent(content: MessageContent): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (p.text) parts.push(p.text);
      else if (p.content) parts.push(p.content);
    }
    return parts.join("\n");
  }
  return "";
}
/* oxlint-enable anti-slop(no-runtime-typeof) */

function assistantTextContent(content: MessageContent): string | null {
  const t = textContent(content);
  return t.length > 0 ? t : null;
}

interface ToolCallPart {
  type: string;
  toolName?: string;
}

export function extractConversationText(messages: WsMessage[]): string {
  const lines: string[] = [];
  for (const m of messages) {
    // SAFETY: WsMessage is a union with discriminant `role`
    const msg = m as { role: string; content: MessageContent };
    if (msg.role === "tool") continue;
    if (msg.role === "user") {
      const t = textContent(msg.content);
      if (t) lines.push(`[user]: ${t}`);
    } else if (msg.role === "assistant") {
      const t = assistantTextContent(msg.content);
      if (t) lines.push(`[assistant]: ${t}`);
      if (Array.isArray(msg.content)) {
        for (const p of msg.content as ToolCallPart[]) {
          if (p.type === "tool-call" && p.toolName) {
            lines.push(`[tool_call]: ${p.toolName}`);
          }
        }
      }
    }
  }
  return lines.join("\n");
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

// ─── Prompts ─────────────────────────────────────────────────────────────────

function compactionSystem(personaName: string): string {
  return [
    `你正在为 ${personaName} 压缩主心智的工作记忆。将一段对话和思考过程浓缩为简短的记忆条目，供下一个检查点使用。`,
    "",
    "保留：",
    "- 与他人形成的关系判断（喜欢、信任、警惕、默契等）",
    '- 未完成的承诺和待办（"答应了某人稍后回复"、"需要查一个东西"）',
    '- 跨频道的决策和理由（"因为 X 从群 A 切到群 B"）',
    '- 重要事实和偏好发现（"用户 A 是程序员，偏好简洁回复"）',
    '- 情感和态度的形成或变化（"对这个话题感到厌烦"、"和用户 B 聊得来"）',
    '- 正在进行中的对话线索（"用户 C 在等我回复关于明天的安排"）',
    "",
    "不保留：",
    "- 可以从聊天记录恢复的原始消息内容",
    "- 工具调用的技术细节（参数、返回值）",
    "- 已经完全解决且无后续影响的事务",
    "- 重复或冗余信息",
    "- 时间戳和消息 ID",
    "",
    "输出格式：直接输出记忆条目，无标题无前缀。使用短句，每条以 · 开头，一行一条。",
    '如果对话中没有值得记住的内容，输出"(无新记忆)"。',
  ].join("\n");
}

function compactionPrompt(persona: string, previous: string | null, conversation: string): string {
  return [
    "<persona>",
    persona,
    "</persona>",
    "",
    "<previous_memory>",
    previous ?? "(无)",
    "</previous_memory>",
    "",
    "<conversation>",
    conversation,
    "</conversation>",
  ].join("\n");
}

// ─── Run ─────────────────────────────────────────────────────────────────────

export async function compact(opts: {
  workspace: WsMessage[];
  previousCompaction: string | null;
  persona: string;
  personaName: string;
  model: LanguageModel;
  signal?: AbortSignal;
}): Promise<string> {
  const conversation = extractConversationText(opts.workspace);
  if (!conversation.trim()) return opts.previousCompaction ?? "(无新记忆)";
  const system = compactionSystem(opts.personaName);
  const prompt = compactionPrompt(opts.persona, opts.previousCompaction, conversation);
  const result = await generateText({
    model: opts.model,
    system,
    prompt,
    abortSignal: opts.signal,
  });
  const text = (result.text ?? "").trim();
  if (!text) return opts.previousCompaction ?? "(无新记忆)";
  if (opts.previousCompaction) return `${opts.previousCompaction}\n${text}`;
  return text;
}
