import { fileURLToPath } from "node:url";

import { Channel, MessageEncoder } from "@athena-ai/protocol-im";
import { Element } from "@cordisjs/element";

import { CQCode } from "./cqcode.js";
import type { OneBotBody } from "./index.js";

const PRIVATE_PFX = "private:";

interface Author {
  id?: string;
  name?: string;
  time?: string | number;
  messageId?: string;
}

class State {
  author: Partial<Author> = {};
  children: CQCode[] = [];
  canonical: Element[] = [];

  constructor(public type: "message" | "forward") {}
}

export class OneBotMessageEncoder extends MessageEncoder<OneBotBody> {
  private stack: State[] = [new State("message")];
  private children: CQCode[] = [];
  private canonical: Element[] = [];

  get isDirect(): boolean {
    return this.channelId.startsWith(PRIVATE_PFX);
  }

  private push(platform: CQCode, canonical: Element): void {
    this.children.push(platform);
    this.canonical.push(canonical);
  }

  private text(text: string): void {
    this.push({ type: "text", data: { text } }, Element("text", { content: text }));
  }

  private lineBreak(): void {
    const platform = this.children[this.children.length - 1];
    const canonical = this.canonical[this.canonical.length - 1];
    if (platform?.type !== "text" || canonical?.type !== "text") {
      this.text("\n");
      return;
    }
    if (platform.data.text.endsWith("\n")) return;
    platform.data.text += "\n";
    canonical.attrs.content += "\n";
  }

  private dispatchSend(messageId: string, elements: Element[]): void {
    const content = elements.map((element) => element.toString()).join("");
    const channel = { id: this.channelId, type: this.isDirect ? Channel.Type.DIRECT : Channel.Type.TEXT };
    const guild = this.isDirect ? undefined : { id: this.channelId };
    const user = this.body.user ?? { id: this.body.selfId };
    const message = { id: messageId, content, elements, user, channel, guild };
    this.body.dispatch(this.body.session({ type: "send", user, channel, guild, message }));
    this.results.push(message);
  }

  private async forward(): Promise<void> {
    const state = this.stack[0];
    if (!state.children.length) return;
    const messageId = this.isDirect
      ? `${await this.body.internal.sendPrivateForwardMsg(this.channelId.slice(PRIVATE_PFX.length), state.children)}`
      : `${await this.body.internal.sendGroupForwardMsg(this.channelId, state.children)}`;
    this.dispatchSend(messageId, [Element("figure", {}, state.canonical)]);
    state.children = [];
    state.canonical = [];
  }

  async flush(): Promise<void> {
    if (this.children.length !== this.canonical.length) throw new Error("OneBot encoder platform and canonical segments drifted");

    while (true) {
      const first = this.children[0];
      if (first?.type !== "text") break;
      const canonical = this.canonical[0];
      if (canonical?.type !== "text") throw new Error("OneBot encoder text segments drifted");
      first.data.text = first.data.text.trimStart();
      canonical.attrs.content = first.data.text;
      if (first.data.text) break;
      this.children.shift();
      this.canonical.shift();
    }

    while (true) {
      const last = this.children[this.children.length - 1];
      if (last?.type !== "text") break;
      const canonical = this.canonical[this.canonical.length - 1];
      if (canonical?.type !== "text") throw new Error("OneBot encoder text segments drifted");
      last.data.text = last.data.text.trimEnd();
      canonical.attrs.content = last.data.text;
      if (last.data.text) break;
      this.children.pop();
      this.canonical.pop();
    }

    const { type, author } = this.stack[0];
    if (!this.children.length && !author.messageId) return;
    if (type === "forward") {
      const parent = this.stack[1];
      if (!parent) throw new Error("OneBot forward state has no parent");
      if (author.messageId) {
        parent.children.push({ type: "node", data: { id: author.messageId } });
        parent.canonical.push(Element("message", { id: author.messageId }));
      } else {
        const name = author.name || this.body.user?.name || "";
        const userId = author.id || this.body.selfId;
        const time = `${Math.floor((+author.time! || Date.now()) / 1000)}`;
        parent.children.push({
          type: "node",
          data: {
            name,
            uin: userId,
            // SAFETY: OneBot forward API accepts CQCode[] directly; the string type in the interface is for the serialized form (koishi parity).
            // oxlint-disable-next-line anti-slop/no-chained-type-assertions
            content: this.children as unknown as string,
            time,
          },
        });
        parent.canonical.push(Element("message", { userId, username: name, time }, this.canonical));
      }

      this.children = [];
      this.canonical = [];
      return;
    }

    const platform = this.children;
    const canonical = this.canonical;
    const messageId = this.isDirect
      ? `${await this.body.internal.sendPrivateMsg(this.channelId.slice(PRIVATE_PFX.length), platform)}`
      : `${await this.body.internal.sendGroupMsg(this.channelId, platform)}`;
    this.dispatchSend(messageId, canonical);
    this.children = [];
    this.canonical = [];
  }

  private async sendFile(attrs: Record<string, string>): Promise<void> {
    const src: string = attrs.src || attrs.url;
    const name = attrs.title || (await this.resolveFilename(src));
    const file = src.startsWith("file:") ? fileURLToPath(src) : await this.body.internal.downloadFile(src);
    if (this.isDirect) {
      await this.body.internal.uploadPrivateFile(this.channelId.slice(PRIVATE_PFX.length), file, name);
    } else {
      await this.body.internal.uploadGroupFile(this.channelId, file, name);
    }
    // The upload APIs expose no platform message id; preserve that fact rather
    // than inventing one, while still dispatching the canonical sent entity.
    this.dispatchSend("", [Element("file", { src, title: name })]);
  }

  /**
   * Resolve a filename from a URL. Attempts to use Content-Disposition
   * header via HEAD request; falls back to the URL's last path segment.
   */
  private async resolveFilename(src: string): Promise<string> {
    try {
      const response = await this.body.ctx.http.head(src, { responseType: "headers" });
      const disposition = response.get("content-disposition");
      if (disposition) {
        const match = /filename="?([^";\n]+)"?/.exec(disposition);
        if (match) return match[1].trim();
      }
    } catch {
      // fall through
    }
    return src.split("/").pop() || "file";
  }

  async visit(element: Element): Promise<void> {
    let { type, attrs, children } = element;
    if (type === "text") {
      this.text(attrs.content);
    } else if (type === "br") {
      this.text("\n");
    } else if (type === "p") {
      this.lineBreak();
      await this.render(children);
      this.text("\n");
    } else if (type === "at") {
      if (attrs.type === "all") {
        this.push({ type: "at", data: { qq: "all" } }, Element("at", { type: "all" }));
      } else {
        this.push({ type: "at", data: { qq: attrs.id, name: attrs.name } }, Element("at", { id: attrs.id, name: attrs.name }));
      }
    } else if (type === "sharp") {
      if (attrs.id) this.text(attrs.id);
    } else if (type === "face") {
      if (attrs.platform && attrs.platform !== this.body.platform) {
        await this.render(children);
      } else {
        this.push({ type: "face", data: { id: attrs.id } }, Element("face", { id: attrs.id }));
      }
    } else if (type === "a") {
      await this.render(children);
      if (attrs.href) this.text(`（${attrs.href}）`);
    } else if (["video", "audio", "image", "img"].includes(type)) {
      if (type === "video" || type === "audio") await this.flush();
      const canonicalType = type === "img" ? "image" : type;
      const source = attrs.src || attrs.url;
      const canonicalAttrs: Element["attrs"] = { ...attrs, src: source };
      delete canonicalAttrs.url;
      delete canonicalAttrs.file;
      const platformType = canonicalType === "audio" ? "record" : canonicalType;
      const platformAttrs: Element["attrs"] = { ...attrs, file: source };
      delete platformAttrs.src;
      delete platformAttrs.url;
      platformAttrs.cache = attrs.cache ? 1 : 0;
      const cap = /^data:([\w/.+-]+);base64,/.exec(platformAttrs.file);
      if (cap) platformAttrs.file = `base64://${platformAttrs.file.slice(cap[0].length)}`;
      this.push({ type: platformType, data: platformAttrs }, Element(canonicalType, canonicalAttrs));
    } else if (type === "file") {
      await this.flush();
      await this.sendFile(attrs);
    } else if (type === "onebot:music") {
      await this.flush();
      this.push({ type: "music", data: attrs }, Element("onebot:music", attrs));
    } else if (type === "onebot:tts") {
      await this.flush();
      this.push({ type: "tts", data: attrs }, Element("onebot:tts", attrs));
    } else if (type === "onebot:poke") {
      await this.flush();
      this.push({ type: "poke", data: attrs }, Element("onebot:poke", attrs));
    } else if (type === "onebot:gift") {
      await this.flush();
      this.push({ type: "gift", data: attrs }, Element("onebot:gift", attrs));
    } else if (type === "onebot:share") {
      await this.flush();
      this.push({ type: "share", data: attrs }, Element("onebot:share", attrs));
    } else if (type === "onebot:json") {
      await this.flush();
      this.push({ type: "json", data: attrs }, Element("onebot:json", attrs));
    } else if (type === "onebot:xml") {
      await this.flush();
      this.push({ type: "xml", data: attrs }, Element("onebot:xml", attrs));
    } else if (type === "onebot:cardimage") {
      await this.flush();
      this.push({ type: "cardimage", data: attrs }, Element("onebot:cardimage", attrs));
    } else if (type === "author") {
      Object.assign(this.stack[0].author, attrs);
    } else if (type === "figure") {
      await this.flush();
      this.stack.unshift(new State("forward"));
      await this.render(children);
      await this.flush();
      this.stack.shift();
      await this.forward();
    } else if (type === "quote") {
      await this.flush();
      this.push({ type: "reply", data: attrs }, Element("quote", attrs));
    } else if (type === "message") {
      await this.flush();
      if ("forward" in attrs) {
        this.stack.unshift(new State("forward"));
        await this.render(children);
        await this.flush();
        this.stack.shift();
        await this.forward();
      } else if ("id" in attrs) {
        this.stack[0].author.messageId = attrs.id.toString();
      } else {
        if (attrs.userId) this.stack[0].author.id = String(attrs.userId);
        if (attrs.username || attrs.nickname) this.stack[0].author.name = String(attrs.username ?? attrs.nickname ?? "");
        if (attrs.time) this.stack[0].author.time = attrs.time;
        await this.render(children);
        await this.flush();
      }
    } else {
      await this.render(children);
    }
  }
}
