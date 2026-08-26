import { Schema, generateText } from "@athena-ai/core";
import { CortexService } from "@athena-ai/protocol";
import { IMMessageEvent } from "@athena-ai/protocol-im";
import { Context, Logger } from "cordis";

import { MessageStore } from "./message-store.js";
import { WorkspaceStore } from "./workspace-store.js";

class CortexChat extends CortexService {
  public static readonly name = "cortex-chat";
  public static readonly inject = ["life", "nerve", "ai", "database"];

  public readonly config: CortexChat.Config;
  public readonly logger: Logger;
  public readonly messages: MessageStore;
  public readonly workspace: WorkspaceStore;

  constructor(ctx: Context, config: CortexChat.Config) {
    super(ctx, "cortex");

    this.config = config;
    this.logger = ctx.logger("cortex-chat");
    this.messages = new MessageStore(ctx);
    this.workspace = new WorkspaceStore(ctx);

    ctx.on("message-created", (event: IMMessageEvent) => {
      this.onMessage(event);
    });
  }

  private async onMessage(event: IMMessageEvent) {
    if (event.userId === event.selfId) return;

    // Archive incoming message
    await this.messages.store({
      platform: event.platform,
      id: event.messageId,
      channelId: event.channelId,
      userId: event.userId,
      content: event.content,
      timestamp: event.timestamp,
    });

    const name = this.ctx.life.id;
    try {
      const model = this.ctx.ai.language("deepseek:deepseek-v4-flash");
      const result = await generateText({
        model,
        instructions: `You are a helpful assistant named ${name}.`,
        messages: [
          {
            role: "user",
            content: event.content,
          },
        ],
      });

      await event.body.sendMessage(event.channelId, result.text);
    } catch (error) {
      this.logger.warn("Failed to reply:", error);
    }
  }
}

namespace CortexChat {
  export interface Config {}
  export const Config: Schema<Config> = Schema.object({});
}

export default CortexChat;
