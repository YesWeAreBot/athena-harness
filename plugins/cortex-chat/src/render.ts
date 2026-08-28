import type { ModelMessage, ToolModelMessage, UserModelMessage } from "@athena-ai/core";

import type { Frame } from "./checkpoint.js";
import type { StoredMessage } from "./message-store.js";

export interface AwarenessMessageInput {
  readonly message: StoredMessage;
  readonly trigger: "direct" | "mention";
  readonly context: readonly StoredMessage[];
  readonly reason?: string;
  readonly suggestion?: string;
}

function escapeXml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sceneText(message: StoredMessage): string {
  return `${message.bodySid}/${message.channelId}`;
}

function sceneAttributes(message: StoredMessage): string {
  return `from="${escapeXml(message.userId)}" scene="${escapeXml(sceneText(message))}" ts="${formatTime(message.timestamp)}" id="${escapeXml(message.messageId)}"`;
}

export function renderUserMessage(message: StoredMessage): UserModelMessage {
  return {
    role: "user",
    content: `<message ${sceneAttributes(message)}>${escapeXml(message.content)}</message>`,
  };
}

export function renderAwarenessMessage(input: AwarenessMessageInput): UserModelMessage {
  const context = input.context.length === 0 ? "(no context)" : input.context.map((message) => renderUserMessage(message).content).join("\n");
  const lines = [
    `<awareness source="${escapeXml(sceneText(input.message))}" trigger="${input.trigger}" ${sceneAttributes(input.message)}>`,
    `<content>${escapeXml(input.message.content)}</content>`,
    "<context>",
    context,
    "</context>",
  ];
  if (input.reason !== undefined) lines.push(`<reason>${escapeXml(input.reason)}</reason>`);
  if (input.suggestion !== undefined) lines.push(`<suggestion>${escapeXml(input.suggestion)}</suggestion>`);
  lines.push("</awareness>");
  return { role: "user", content: lines.join("\n") };
}

function renderToolMessage(message: ToolModelMessage): string {
  return message.content
    .map((part) => {
      if (part.type === "tool-approval-response") return `[tool approval] ${part.approved ? "granted" : "denied"}`;
      const output = part.output;
      if (output.type === "text" || output.type === "error-text") return output.value;
      if (output.type === "execution-denied") return output.reason ?? "tool execution denied";
      if (output.type === "content")
        return output.value.map((entry) => (entry.type === "text" ? entry.text : `[file ${"mediaType" in entry ? entry.mediaType : entry.type}]`)).join("\n");
      return JSON.stringify(output.value);
    })
    .join("\n");
}

function renderModelMessage(message: ModelMessage): string {
  if (message.role === "user") {
    if (typeof message.content === "string") return /^<(?:message|awareness)\b/.test(message.content) ? message.content : escapeXml(message.content);
    return message.content
      .map((part) => (part.type === "text" ? escapeXml(part.text) : `[file ${"mediaType" in part ? part.mediaType : part.type}]`))
      .join("\n");
  }
  if (message.role === "system") {
    if (typeof message.content !== "string") return String(message.content);
    return /^<focusChange\b/.test(message.content) ? message.content : escapeXml(message.content);
  }
  if (message.role === "tool") return renderToolMessage(message);
  if (typeof message.content === "string") return `[assistant] ${escapeXml(message.content)}`;
  return message.content
    .map((part) => {
      if (part.type === "text") return `[assistant] ${escapeXml(part.text)}`;
      if (part.type === "file") return `[assistant file ${part.mediaType}]`;
      return "";
    })
    .filter((line) => line.length > 0)
    .join("\n");
}

function renderFrameMessage(message: ModelMessage): string {
  return renderModelMessage(message);
}

/** Deterministically projects the structured checkpoint frame into model messages. */
export function renderFrame(frame: Frame): readonly ModelMessage[] {
  const focus = frame.focus
    ? `<focus bodySid="${escapeXml(frame.focus.bodySid)}" channelId="${escapeXml(frame.focus.channelId)}">${escapeXml(`${frame.focus.bodySid}/${frame.focus.channelId}`)}</focus>`
    : '<focus none="true">none</focus>';
  const history = frame.history.length === 0 ? "(no history)" : frame.history.map(renderFrameMessage).join("\n");
  const lastFocusHistory = frame.lastFocusHistory.length === 0 ? "(none)" : frame.lastFocusHistory.map(renderFrameMessage).join("\n");
  const content = ["<frame>", focus, "<history>", history, "</history>", "<last_focus_history>", lastFocusHistory, "</last_focus_history>", "</frame>"].join(
    "\n",
  );
  return [{ role: "user", content }];
}
