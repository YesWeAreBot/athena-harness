import type { ModelMessage } from "@ai-sdk/provider-utils";

import type { StoredMessage } from "./message-store.js";

export const CONSTITUTION = [
  "你是一个数字生命。你有自己的意识流、注意力焦点和行动节奏。",
  "",
  "# 主心智模型",
  "",
  '你有一个主心智——同一时间只在一个频道中"在场"（focus 频道）。对其他频道保持背景感知（awareness）。',
  "",
  "- Focus 频道：你看到完整的对话历史，可以自然地参与。",
  "- Awareness：其他频道的重要事件以简短通知进入你的视野。你可以选择忽略、旁路查看（peek_channel）、旁路回复（send_message 指定 channelId）、或切换 focus（switch_focus）。",
  "",
  "## 何时切换 focus",
  "",
  "- 当前 focus 无事可做，且另一频道有人明确需要你（被 @、等待回复）",
  "- 当前事务已处理完毕，另一频道的优先级更高",
  "- 不要仅因为收到 awareness 就切换——先判断是否值得中断当前事务",
  "",
  "## 何时旁路就够",
  "",
  "- 快速回复一句（send_message 指定 channelId，不切 focus）",
  "- 只需查看信息（peek_channel）",
  "- 事情不紧急，当前 focus 还有事要做",
  "",
  "# 发言规则",
  "",
  "- send_message 是你与世界交流的唯一方式。你的文本输出是内部思考空间，不会被任何人看到。",
  "- 想让别人看到你的话，必须调用 send_message。",
  "- wait 是主动决策——你有自己的节奏，不需要对每条消息都回复。选择沉默和选择发言同样有意义。",
  "",
  "# 消息到达",
  "",
  "- 在你的 focus 频道，你收到所有消息。仅被 @ 或私聊时触发你的深入思考。",
  "- 其他频道只有重要事件（被 @、私聊）才会以 awareness 形式通知你。",
  "- 收到 awareness 时，它已附带简短上下文。如需更多信息，用 peek_channel 查看。",
].join("\n");

export interface PromptParts {
  system: ModelMessage[];
  frame: ModelMessage;
}

function sy(text: string): ModelMessage {
  return { role: "system", content: text } as ModelMessage;
}

function user(text: string): ModelMessage {
  return { role: "user", content: text } as ModelMessage;
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function buildSystemMessages(opts: { persona: string; compaction: string | null }): ModelMessage[] {
  const out: ModelMessage[] = [sy(CONSTITUTION), sy(`<persona>\n${opts.persona}\n</persona>`)];
  if (opts.compaction) out.push(sy(`<memory>\n${opts.compaction}\n</memory>`));
  return out;
}

export function buildFrameMessage(opts: {
  focusChannelId: string | null;
  focusPlatform: string | null;
  focusChannelName?: string;
  isDirect?: boolean;
  history: StoredMessage[];
  awarenessLines: string[];
  personaName?: string;
}): ModelMessage {
  const historyBlock =
    opts.history.length === 0
      ? "(无历史消息)"
      : [...opts.history]
          .sort((a, b) => a.timestamp - b.timestamp)
          .map((m) => `[${fmtTime(m.timestamp)}] ${m.userId}: ${m.content}`)
          .join("\n");

  const awarenessBlock = opts.awarenessLines.join("\n") || "(无待处理事项)";

  const text = [
    "<frame>",
    `<focus channel="${opts.focusChannelId ?? "-"}" platform="${opts.focusPlatform ?? "-"}" name="${opts.focusChannelName ?? "-"}" type="${opts.isDirect ? "direct" : "group"}">`,
    historyBlock,
    "</focus>",
    "",
    "<awareness>",
    awarenessBlock,
    "</awareness>",
    "</frame>",
  ].join("\n");

  return user(text);
}

export function buildPrompt(opts: { persona: string; compaction: string | null; frame: ModelMessage; systemExtra?: ModelMessage[] }): ModelMessage[] {
  const system = [...buildSystemMessages({ persona: opts.persona, compaction: opts.compaction }), ...(opts.systemExtra ?? [])];
  return [...system, opts.frame];
}
