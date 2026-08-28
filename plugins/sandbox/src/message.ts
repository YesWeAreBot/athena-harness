import { Channel, MessageEncoder } from "@athena-ai/protocol-im";
import { Element, parse } from "@cordisjs/element";

import type { SandboxBot } from "./bot.js";

/** Element types whose `src`/`url` attribute points at a resource. */
const RESOURCE_TYPES = ["image", "img", "audio", "video", "file"];

/**
 * `file:` urls mean nothing to a browser, so route them through the sandbox
 * file server when the operator has opted into it.
 */
function rewriteResource(element: Element, fileBase: string | undefined): Element {
  const { type, attrs, children } = element;
  const src: string = attrs.src || attrs.url;
  if (RESOURCE_TYPES.includes(type) && src?.startsWith("file:") && fileBase) {
    return Element(type, { ...attrs, src: `${fileBase}?url=${encodeURIComponent(src)}` }, children);
  }
  return element;
}

export class SandboxMessenger extends MessageEncoder<SandboxBot> {
  private buffer = "";

  async flush() {
    if (!this.buffer.trim()) return;
    const content = this.buffer.trim();
    const messageId = Math.random().toString(36).slice(2);
    this.body.config.sink.send({
      type: "sandbox/message",
      body: {
        id: messageId,
        content,
        user: this.body.user?.name,
        channel: this.channelId,
        platform: this.body.platform,
      },
    });

    // Outbound messages are archived from the `send` event, exactly like on a
    // real platform: without it a Life's own replies never reach its history.
    const channel = this.body.channelOf(this.channelId);
    this.body.dispatch(
      this.body.session({
        type: "send",
        user: this.body.user,
        channel,
        guild: channel.type === Channel.Type.DIRECT ? undefined : { id: this.channelId },
        message: { id: messageId, content, elements: parse(content) },
      }),
    );
    this.results.push({ id: messageId });
    this.buffer = "";
  }

  async visit(element: Element) {
    const { type, children } = element;
    if (type === "message" || type === "figure") {
      await this.flush();
      await this.render(children ?? []);
      await this.flush();
    } else {
      this.buffer += rewriteResource(element, this.body.config.fileBase).toString();
    }
  }
}

export default SandboxMessenger;
