import type { IMMessageEvent, IMSendEvent } from "@athena-ai/protocol-im";
import {} from "@cordisjs/plugin-database";
import type { Context } from "cordis";

import type { SceneAddress, SceneCursor } from "./scene.js";

// ─── Row type (internal, includes lifeId) ───────────────────────────────────

export interface MessageRow {
  lifeId: string;
  bodySid: string;
  channelId: string;
  messageId: string;
  userId: string;
  userName?: string;
  content: string;
  timestamp: number;
  replyTo?: string;
}

// ─── Table Declaration ──────────────────────────────────────────────────────

declare module "@cordisjs/plugin-database" {
  interface Tables {
    "athena.messages": MessageRow;
  }
}

// ─── Public types ───────────────────────────────────────────────────────────

export interface StoredMessage {
  readonly bodySid: string;
  readonly channelId: string;
  readonly messageId: string;
  readonly userId: string;
  readonly userName?: string;
  readonly content: string;
  readonly timestamp: number;
  readonly replyTo?: string;
}

/** Reads are ordered oldest-first; `limit` keeps the most recent rows of the selected range. */
export interface MessageQuery {
  readonly before?: SceneCursor;
  readonly after?: SceneCursor;
  readonly limit?: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function compareCursor(a: SceneCursor, b: SceneCursor): number {
  if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
  if (a.messageId < b.messageId) return -1;
  if (a.messageId > b.messageId) return 1;
  return 0;
}

function isAfter(row: MessageRow, cursor: SceneCursor): boolean {
  return compareCursor({ timestamp: row.timestamp, messageId: row.messageId }, cursor) > 0;
}

function isBefore(row: MessageRow, cursor: SceneCursor): boolean {
  return compareCursor({ timestamp: row.timestamp, messageId: row.messageId }, cursor) < 0;
}

function toStored(row: MessageRow): StoredMessage {
  const msg: StoredMessage = {
    bodySid: row.bodySid,
    channelId: row.channelId,
    messageId: row.messageId,
    userId: row.userId,
    content: row.content,
    timestamp: row.timestamp,
  };
  // preserve optional fields only when present
  if (row.userName !== undefined) (msg as { userName?: string }).userName = row.userName;
  if (row.replyTo !== undefined) (msg as { replyTo?: string }).replyTo = row.replyTo;
  // Use object spread with conditional to satisfy readonly
  return {
    bodySid: row.bodySid,
    channelId: row.channelId,
    messageId: row.messageId,
    userId: row.userId,
    ...(row.userName !== undefined ? { userName: row.userName } : {}),
    content: row.content,
    timestamp: row.timestamp,
    ...(row.replyTo !== undefined ? { replyTo: row.replyTo } : {}),
  } as StoredMessage;
}

// ─── MessageStore ───────────────────────────────────────────────────────────

export class MessageStore {
  private readonly lifeId: string;

  private readonly eventStores = new WeakMap<object, Promise<StoredMessage>>();
  constructor(
    private ctx: Context,
    lifeId?: string,
  ) {
    // Prefer explicit lifeId; fallback to ctx.life.id when available (backwards compat for existing CortexChat constructor).
    const resolved = lifeId ?? (ctx as unknown as { life?: { id?: string } }).life?.id ?? "default";
    this.lifeId = resolved;

    ctx.database.extend(
      "athena.messages",
      {
        lifeId: "string",
        bodySid: "string",
        channelId: "string",
        messageId: "string",
        userId: "string",
        userName: "string",
        content: "text",
        timestamp: "unsigned",
        replyTo: "string",
      },
      {
        primary: ["lifeId", "bodySid", "messageId"],
        indexes: [
          { keys: { lifeId: "asc", bodySid: "asc", channelId: "asc", timestamp: "asc", messageId: "asc" } },
          { keys: { lifeId: "asc", bodySid: "asc", userId: "asc", timestamp: "asc", messageId: "asc" } },
        ],
      },
    );
  }

  attach(): void {
    this.ctx.on("message-created", (event: IMMessageEvent) => {
      void this.storeEvent(event).catch((error) => {
        this.ctx.logger("cortex-chat.message-store").warn("message-created archive failed", { error });
      });
    });
    this.ctx.on("send", (event: IMSendEvent) => {
      void this.storeEvent(event).catch((error) => {
        this.ctx.logger("cortex-chat.message-store").warn("send archive failed", { error });
      });
    });
  }

  async store(message: StoredMessage): Promise<void> {
    const row: MessageRow = {
      lifeId: this.lifeId,
      bodySid: message.bodySid,
      channelId: message.channelId,
      messageId: message.messageId,
      userId: message.userId,
      content: message.content,
      timestamp: message.timestamp,
      ...(message.userName !== undefined ? { userName: message.userName } : {}),
      ...(message.replyTo !== undefined ? { replyTo: message.replyTo } : {}),
    };
    await this.ctx.database.upsert("athena.messages", [row], ["lifeId", "bodySid", "messageId"]);
  }

  storeEvent(event: IMMessageEvent | IMSendEvent): Promise<StoredMessage> {
    const existing = this.eventStores.get(event);
    if (existing) return existing;
    const stored = this.storeEventNow(event);
    this.eventStores.set(event, stored);
    return stored;
  }

  private async storeEventNow(event: IMMessageEvent | IMSendEvent): Promise<StoredMessage> {
    // Derive per brief Step 4.
    const bodySid: string =
      (event as unknown as { body: { sid: string } }).body?.sid ??
      `${(event as unknown as { platform: string }).platform}:${(event as unknown as { selfId: string }).selfId}`;
    const channelId: string = (event as unknown as { channelId: string }).channelId;
    const messageId: string = (event as unknown as { messageId: string }).messageId;
    const userId: string = (event as unknown as { userId: string }).userId;
    const userName: string | undefined = (event as unknown as { user?: { name?: string } }).user?.name;
    // Use already-normalized content string when present; fallback to message.content for send events.
    const contentFromEvent: unknown = (event as unknown as { content?: unknown }).content;
    const contentFromMessage: unknown = (event as unknown as { message?: { content?: unknown } }).message?.content;
    let content: string;
    if (typeof contentFromEvent === "string") {
      content = contentFromEvent;
    } else if (typeof contentFromMessage === "string") {
      content = contentFromMessage;
    } else if (contentFromMessage !== undefined && contentFromMessage !== null) {
      content = String(contentFromMessage);
    } else if (contentFromEvent !== undefined && contentFromEvent !== null) {
      content = String(contentFromEvent);
    } else {
      content = "";
    }
    const timestamp: number = (event as unknown as { timestamp: number }).timestamp ?? Date.now();
    const replyTo: string | undefined = (event as unknown as { message?: { quote?: { id?: string } } }).message?.quote?.id;

    const stored: StoredMessage = {
      bodySid,
      channelId,
      messageId,
      userId,
      ...(userName !== undefined ? { userName } : {}),
      content,
      timestamp,
      ...(replyTo !== undefined ? { replyTo } : {}),
    } as StoredMessage;

    await this.store(stored);
    return stored;
  }

  async readScene(scene: SceneAddress, options: MessageQuery = {}): Promise<readonly StoredMessage[]> {
    const rows = (await this.ctx.database.get("athena.messages", {
      lifeId: this.lifeId,
      bodySid: scene.bodySid,
      channelId: scene.channelId,
    } as never)) as MessageRow[];

    let filtered = rows;
    if (options.after) {
      filtered = filtered.filter((r) => isAfter(r, options.after!));
    }
    if (options.before) {
      filtered = filtered.filter((r) => isBefore(r, options.before!));
    }
    filtered = filtered.sort((a, b) => compareCursor({ timestamp: a.timestamp, messageId: a.messageId }, { timestamp: b.timestamp, messageId: b.messageId }));
    if (options.limit !== undefined && filtered.length > options.limit) {
      filtered = filtered.slice(filtered.length - options.limit);
    }
    return filtered.map(toStored);
  }
}
