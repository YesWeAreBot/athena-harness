import { Element, h, MessageEncoder, transformAsync, type Transform } from "@satorijs/core";
import type { Dict } from "cosmokit";

import type { SandboxBot } from "./bot";

/** Element types whose `src`/`url` attribute points at a resource. */
const RESOURCE_TYPES = ["image", "img", "audio", "video", "file"];

export class SandboxMessenger extends MessageEncoder<SandboxBot> {
  private buffer = "";

  /**
   * `file:` urls mean nothing to a browser, so route them through the sandbox
   * file server when the operator has opted into it.
   */
  private rules: Dict<Transform> = Object.fromEntries(
    RESOURCE_TYPES.map((type) => {
      const tagName = type === "image" ? "img" : type;
      return [
        type,
        (attrs: Dict) => {
          const src: string = attrs.src || attrs.url;
          const fileBase = this.bot.config.fileBase;
          if (src?.startsWith("file:") && fileBase) {
            return h(tagName, { ...attrs, src: `${fileBase}?url=${encodeURIComponent(src)}` });
          }
          return h(tagName, { ...attrs, src });
        },
      ];
    }),
  );

  async flush() {
    if (!this.buffer.trim()) return;
    const content = await transformAsync(this.buffer.trim(), this.rules);
    const session = this.bot.session(this.session.event);
    session.messageId = Math.random().toString(36).slice(2);
    this.bot.config.sink.send({
      type: "sandbox/message",
      body: {
        id: session.messageId,
        content,
        user: this.bot.user!.name,
        channel: session.channelId,
        platform: session.platform,
      },
    });
    session.app.emit(session, "send", session);
    this.results.push(session.event.message!);
    this.buffer = "";
  }

  async visit(element: Element) {
    const { type, children } = element;
    if (type === "message" || type === "figure") {
      await this.flush();
      await this.render(children);
      await this.flush();
    } else {
      this.buffer += element.toString();
    }
  }
}

export default SandboxMessenger;
