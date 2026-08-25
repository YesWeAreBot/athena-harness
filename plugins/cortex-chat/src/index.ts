import { Schema } from "@athena-ai/core";
import { Cortex } from "@athena-ai/protocol";
import { h, type IMMessageEvent } from "@athena-ai/protocol-im";
import { Context } from "cordis";

declare module "cordis" {
  interface Context {
    cortex: CortexChat;
  }
}

export interface Config {}

export default class CortexChat extends Cortex {
  static name = "cortex-chat";

  static inject = ["life", "nerve"];

  static Config: Schema<Config> = Schema.object({});

  constructor(ctx: Context) {
    super(ctx, "cortex");

    // Subscribe to incoming messages from any Nerve body
    ctx.on("message-created", (event: IMMessageEvent) => {
      this.onMessage(event);
    });
  }

  private async onMessage(event: IMMessageEvent) {
    // Skip messages from self
    if (event.userId === event.selfId) return;

    const name = this.ctx.life.id ?? "Life";
    const content = event.content ?? "";

    // v1: echo with a name prefix
    try {
      await event.body.sendMessage(event.channelId, [h.Element("text", { content: `[${name}] Echo: ${content}` })]);
    } catch (error) {
      this.ctx.logger("cortex-chat").warn("Failed to reply:", error);
    }
  }
}
