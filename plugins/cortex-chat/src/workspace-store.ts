import { mkdir, readFile, truncate, appendFile } from "node:fs/promises";
import path from "node:path";

import type { AssistantModelMessage, ModelMessage, SystemModelMessage, ToolModelMessage, UserModelMessage } from "@athena-ai/core";
import { generateId, LanguageModelV4Usage } from "@athena-ai/core";
import type { Context } from "cordis";

// ─── WsMessage Types ────────────────────────────────────────────────────────

export interface MessageMeta {
  id: string;
  ts: number;
}

export interface WsUserMessage extends MessageMeta, UserModelMessage {}
export interface WsSystemMessage extends MessageMeta, SystemModelMessage {}
export interface WsAssistantMessage extends MessageMeta, AssistantModelMessage {
  usage?: LanguageModelV4Usage;
  finishReason?: string;
}
export interface WsToolMessage extends MessageMeta, ToolModelMessage {}

export type WsMessage = WsUserMessage | WsSystemMessage | WsAssistantMessage | WsToolMessage;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Strip metadata, return AI SDK native ModelMessage */
export function toModelMessage(ws: WsMessage): ModelMessage {
  const { id: _id, ts: _ts, ...rest } = ws;
  if (rest.role === "assistant") {
    // SAFETY: rest has role "assistant" and WsMessage is a union of the four
    // role-specific types, so rest must be the assistant member.
    const { usage: _usage, finishReason: _finishReason, ...msg } = rest as Omit<WsAssistantMessage, keyof MessageMeta>;
    return msg;
  }
  return rest;
}

/** Create a WsMessage with auto-generated id and timestamp */
export function createWsMessage<T extends ModelMessage>(msg: T): T & MessageMeta {
  return { id: generateId(), ts: Date.now(), ...msg };
}

// ─── WorkspaceStore ─────────────────────────────────────────────────────────

export class WorkspaceStore {
  private readonly filePath: string;

  constructor(private ctx: Context) {
    this.filePath = path.join(process.cwd(), "cortex-state", "workspace.jsonl");
  }

  /** Ensure directory exists */
  private async ensureDir(): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
  }

  /** Append one or more messages */
  async append(...messages: WsMessage[]): Promise<void> {
    await this.ensureDir();
    const lines = messages.map((m) => `${JSON.stringify(m)}\n`).join("");
    await appendFile(this.filePath, lines, "utf-8");
  }

  /** Read all messages in order */
  async readAll(): Promise<WsMessage[]> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      if (!raw.trim()) return [];
      return raw
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line));
    } catch (error) {
      // SAFETY: readFile only rejects with ErrnoException.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  /** Clear workspace (at checkpoint) */
  async clear(): Promise<void> {
    try {
      await truncate(this.filePath, 0);
    } catch (error) {
      // SAFETY: truncate only rejects with ErrnoException.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }

  /** Line count without parsing JSON */
  async count(): Promise<number> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      if (!raw.trim()) return 0;
      return raw.trimEnd().split("\n").length;
    } catch (error) {
      // SAFETY: readFile only rejects with ErrnoException.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }
}
