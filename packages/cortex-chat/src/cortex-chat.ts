import type {} from "@athena-ai/capability-message";
import type {} from "@athena-ai/core";
import { Cortex } from "@athena-ai/core";
import type { Session } from "@satorijs/core";
import { Context, Service } from "cordis";

export class CortexChat extends Cortex {
  static inject = ["life", "message"];

  constructor(ctx: Context) {
    super(ctx, "cortex");

    // Subscribe to incoming messages
    ctx.on("message", (session: Session) => {
      this.onMessage(session);
    });
  }

  private async onMessage(session: Session) {
    // Skip messages from self
    if (session.userId === session.selfId) return;

    const persona = this.ctx.life.persona;
    const content = session.content ?? "";

    // v1: echo with persona name prefix
    try {
      await this.ctx.message.createMessage(session.channelId!, `[${persona.name}] Echo: ${content}`, session.bot?.sid);
    } catch (e) {
      this.ctx.logger("cortex-chat").warn("Failed to reply:", e);
    }
  }
}
