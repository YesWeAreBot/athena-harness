import { Schema, generateText } from "@athena-ai/core";
import { CortexService } from "@athena-ai/protocol";
import { h, type IMMessageEvent } from "@athena-ai/protocol-im";
import { Context, Logger } from "cordis";

class CortexChat extends CortexService {
  public static readonly name = "cortex-chat";
  public static readonly inject = ["life", "nerve", "ai"];

  public readonly config: CortexChat.Config;
  public readonly logger: Logger;

  constructor(ctx: Context, config: CortexChat.Config) {
    super(ctx, "cortex");

    this.config = config;
    this.logger = ctx.logger("cortex-chat");

    ctx.on("message-created", (event: IMMessageEvent) => {
      this.onMessage(event);
    });
  }

  private async onMessage(event: IMMessageEvent) {
    if (event.userId === event.selfId) return;
    if (event.userId !== "1293865264") return;

    const name = this.ctx.life.id;
    const content = event.content;

    try {
      const model = this.ctx.ai.language("deepseek:deepseek-v4-flash");
      const result = await generateText({
        model,
        instructions: `You are a helpful assistant named ${name}.`,
        messages: [
          {
            role: "user",
            content: content,
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
