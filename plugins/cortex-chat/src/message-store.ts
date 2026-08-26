import {} from "@cordisjs/plugin-database";
import type { Context } from "cordis";

// ─── Table Declaration ──────────────────────────────────────────────────────

declare module "@cordisjs/plugin-database" {
  interface Tables {
    "athena.messages": StoredMessage;
  }
}

export interface StoredMessage {
  platform: string;
  id: string;
  channelId: string;
  userId: string;
  content: string;
  timestamp: number;
  replyTo?: string;
}

// ─── MessageStore ───────────────────────────────────────────────────────────

export class MessageStore {
  constructor(private ctx: Context) {
    ctx.database.extend(
      "athena.messages",
      {
        platform: "string",
        id: "string",
        channelId: "string",
        userId: "string",
        content: "text",
        timestamp: "unsigned",
        replyTo: "string",
      },
      {
        primary: ["platform", "id"],
        indexes: [{ keys: { platform: "asc", channelId: "asc", timestamp: "desc" } }, { keys: { platform: "asc", userId: "asc", timestamp: "desc" } }],
      },
    );
  }

  /** Idempotent write (upsert by platform+id) */
  async store(msg: StoredMessage): Promise<void> {
    await this.ctx.database.upsert("athena.messages", [msg], ["platform", "id"]);
  }

  /** Fetch channel history (for focus expansion) */
  async getByChannel(
    platform: string,
    channelId: string,
    options: {
      before?: number;
      limit?: number;
    } = {},
  ): Promise<StoredMessage[]> {
    const { before, limit = 50 } = options;
    const query = before !== undefined ? { platform, channelId, timestamp: { $lt: before } } : { platform, channelId };
    return this.ctx.database.get("athena.messages", query, {
      limit,
      sort: { timestamp: "desc" },
    });
  }

  /** Fetch user history (for side-channel reads) */
  async getByUser(
    platform: string,
    userId: string,
    options: {
      before?: number;
      limit?: number;
    } = {},
  ): Promise<StoredMessage[]> {
    const { before, limit = 50 } = options;
    const query = before !== undefined ? { platform, userId, timestamp: { $lt: before } } : { platform, userId };
    return this.ctx.database.get("athena.messages", query, {
      limit,
      sort: { timestamp: "desc" },
    });
  }
}
