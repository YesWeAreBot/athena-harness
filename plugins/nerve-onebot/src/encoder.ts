import { MessageEncoder } from "@athena-ai/protocol-im";
import type { Element } from "@cordisjs/element";

import type { OneBotBody } from "./body.js";
import type { CQCode as CQCodeType } from "./types.js";

const PRIVATE_PFX = "private:";

export class OneBotMessageEncoder extends MessageEncoder<OneBotBody> {
  private children: CQCodeType[] = [];

  async flush(): Promise<void> {
    if (this.children.length === 0) return;
    try {
      const messageId = this.channelId.startsWith(PRIVATE_PFX)
        ? await this.body.internal.sendPrivateMsg(this.channelId.slice(PRIVATE_PFX.length), this.children)
        : await this.body.internal.sendGroupMsg(this.channelId, this.children);
      this.results.push({ id: String(messageId) });
    } catch (error) {
      this.errors.push(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.children = [];
    }
  }

  async visit(element: Element): Promise<void> {
    const attrs = element.attrs;
    switch (element.type) {
      case "text":
        this.children.push({ type: "text", data: { text: String(attrs.content ?? "") } });
        break;
      case "image":
      case "img":
        this.children.push({ type: "image", data: { file: String(attrs.src ?? attrs.url ?? "") } });
        break;
      case "at":
        this.children.push({ type: "at", data: { qq: attrs.type === "all" ? "all" : String(attrs.id ?? "") } });
        break;
      case "quote":
        this.children.push({ type: "reply", data: { id: String(attrs.id ?? "") } });
        break;
      case "face":
        this.children.push({ type: "face", data: { id: String(attrs.id ?? "") } });
        break;
      default:
        for (const child of element.children ?? []) await this.visit(child);
        break;
    }
  }
}
