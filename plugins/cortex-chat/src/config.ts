import { Schema } from "@athena-ai/core";

export interface CortexChatConfig {
  model: string;
  compactModel: string;
  maxSteps: number;
  aggregateWindow: number;
  compactThreshold: number;
  idleTimeout: number;
  initialFocus: string;
  pacing: { charactersPerSecond: number; maxTotalDelayMs: number };
  customInnerThought: boolean;
  focusHistoryLimit: number;
  toolOutputMaxChars: number;
  toolOutputHeadChars: number;
  toolOutputTailChars: number;
}

export const CortexChatConfigSchema: Schema<CortexChatConfig> = Schema.object({
  model: Schema.string().default("").description("主模型 ID（如 openai:gpt-4o）。留空使用 AI Service 默认值。"),
  compactModel: Schema.string().default("").description("压缩模型 ID。留空则使用主模型。"),
  maxSteps: Schema.number().default(15).description("单次 turn 最大 step 数"),
  aggregateWindow: Schema.number().default(1500).description("聚合窗口时间（ms）。trigger 到达后等待此时间收集后续消息。"),
  compactThreshold: Schema.number().default(8000).description("workspace 触发压缩的 token 估算阈值"),
  idleTimeout: Schema.number().default(300_000).description("idle 超时触发压缩（ms），0 禁用"),
  initialFocus: Schema.string().default("").description("启动时默认 focus 场景的编码 SceneAddress（bodySid/channelId），留空则首条 trigger 自动设定"),
  pacing: Schema.object({
    charactersPerSecond: Schema.number().default(8).description("send_message 相邻消息的发送速度（字符/秒）"),
    maxTotalDelayMs: Schema.number().default(60_000).description("单次 send_message 的最大累计延迟（ms）"),
  }).description("消息发送节奏"),
  customInnerThought: Schema.boolean().default(true).description("为 send_message 提供 inner_thought 字段"),
  focusHistoryLimit: Schema.number().default(30).description("focus 展开或 awareness 通知时从 message-store 加载的最大消息数"),
  toolOutputMaxChars: Schema.number().default(1_000).description("Maximum characters retained for one successful tool output during frame pruning"),
  toolOutputHeadChars: Schema.number().default(400).description("Characters retained from the beginning of a large successful tool output"),
  toolOutputTailChars: Schema.number().default(400).description("Characters retained from the end of a large successful tool output"),
});
