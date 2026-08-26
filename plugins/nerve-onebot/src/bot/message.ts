import { fileURLToPath } from "node:url";

import { MessageEncoder } from "@athena-ai/protocol-im";
import type { Element } from "@cordisjs/element";

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

  constructor(public type: "message" | "forward") {}
}

export class OneBotMessageEncoder extends MessageEncoder<OneBotBody> {
  private stack: State[] = [new State("message")];
  private children: CQCode[] = [];

  get isDirect(): boolean {
    return this.channelId.startsWith(PRIVATE_PFX);
  }

  private text(text: string): void {
    this.children.push({ type: "text", data: { text } });
  }

  private async forward(): Promise<void> {
    if (!this.stack[0].children.length) return;
    const session = this.body.session();
    session.type = "send";
    session.content = "";
    session.messageId = this.isDirect
      ? `${await this.body.internal.sendPrivateForwardMsg(this.channelId.slice(PRIVATE_PFX.length), this.stack[0].children)}`
      : `${await this.body.internal.sendGroupForwardMsg(this.channelId, this.stack[0].children)}`;
    session.userId = this.body.selfId;
    session.channelId = this.channelId;
    session.guildId = this.isDirect ? undefined : this.channelId;
    session.isDirect = this.isDirect;
    this.body.dispatch(session);
    this.results.push({ id: session.messageId! });
  }

  async flush(): Promise<void> {
    // trim start
    while (true) {
      const first = this.children[0];
      if (first?.type !== "text") break;
      first.data.text = first.data.text.trimStart();
      if (first.data.text) break;
      this.children.shift();
    }

    // trim end
    while (true) {
      const last = this.children[this.children.length - 1];
      if (last?.type !== "text") break;
      last.data.text = last.data.text.trimEnd();
      if (last.data.text) break;
      this.children.pop();
    }

    // flush
    const { type, author } = this.stack[0];
    if (!this.children.length && !author.messageId) return;
    if (type === "forward") {
      if (author.messageId) {
        this.stack[1].children.push({
          type: "node",
          data: {
            id: author.messageId,
          },
        });
      } else {
        this.stack[1].children.push({
          type: "node",
          data: {
            name: author.name || this.body.user?.name || "",
            uin: author.id || this.body.selfId,
            // SAFETY: OneBot forward API accepts CQCode[] directly; the string type in the interface is for the serialized form (koishi parity);
            // oxlint-disable-next-line anti-slop/no-chained-type-assertions
            content: this.children as unknown as string,
            time: `${Math.floor((+author.time! || Date.now()) / 1000)}`,
          },
        });
      }

      this.children = [];
      return;
    }

    const session = this.body.session();
    session.type = "send";
    session.content = "";
    session.messageId = this.isDirect
      ? `${await this.body.internal.sendPrivateMsg(this.channelId.slice(PRIVATE_PFX.length), this.children)}`
      : `${await this.body.internal.sendGroupMsg(this.channelId, this.children)}`;
    session.userId = this.body.selfId;
    session.channelId = this.channelId;
    session.guildId = this.isDirect ? undefined : this.channelId;
    session.isDirect = this.isDirect;
    this.body.dispatch(session);
    this.results.push({ id: session.messageId! });
    this.children = [];
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
    const session = this.body.session();
    session.type = "send";
    // 相关 API 没有返回 message_id
    session.messageId = "";
    session.content = "";
    session.userId = this.body.selfId;
    session.channelId = this.channelId;
    session.guildId = this.isDirect ? undefined : this.channelId;
    session.isDirect = this.isDirect;
    this.body.dispatch(session);
    this.results.push({ id: "" });
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
      const prev = this.children[this.children.length - 1];
      if (prev?.type === "text") {
        if (!prev.data.text.endsWith("\n")) {
          prev.data.text += "\n";
        }
      } else {
        this.text("\n");
      }
      await this.render(children);
      this.text("\n");
    } else if (type === "at") {
      if (attrs.type === "all") {
        this.children.push({ type: "at", data: { qq: "all" } });
      } else {
        this.children.push({ type: "at", data: { qq: attrs.id, name: attrs.name } });
      }
    } else if (type === "sharp") {
      if (attrs.id) this.text(attrs.id);
    } else if (type === "face") {
      if (attrs.platform && attrs.platform !== this.body.platform) {
        await this.render(children);
      } else {
        this.children.push({ type: "face", data: { id: attrs.id } });
      }
    } else if (type === "a") {
      await this.render(children);
      if (attrs.href) this.text(`（${attrs.href}）`);
    } else if (["video", "audio", "image", "img"].includes(type)) {
      if (type === "video" || type === "audio") await this.flush();
      if (type === "audio") type = "record";
      if (type === "img") type = "image";
      attrs = { ...attrs };
      attrs.file = attrs.src || attrs.url;
      delete attrs.src;
      delete attrs.url;
      if (attrs.cache) {
        attrs.cache = 1;
      } else {
        attrs.cache = 0;
      }
      const cap = /^data:([\w/.+-]+);base64,/.exec(attrs.file);
      if (cap) attrs.file = `base64://${attrs.file.slice(cap[0].length)}`;
      this.children.push({ type, data: attrs });
    } else if (type === "file") {
      await this.flush();
      await this.sendFile(attrs);
    } else if (type === "onebot:music") {
      await this.flush();
      this.children.push({ type: "music", data: attrs });
    } else if (type === "onebot:tts") {
      await this.flush();
      this.children.push({ type: "tts", data: attrs });
    } else if (type === "onebot:poke") {
      await this.flush();
      this.children.push({ type: "poke", data: attrs });
    } else if (type === "onebot:gift") {
      await this.flush();
      this.children.push({ type: "gift", data: attrs });
    } else if (type === "onebot:share") {
      await this.flush();
      this.children.push({ type: "share", data: attrs });
    } else if (type === "onebot:json") {
      await this.flush();
      this.children.push({ type: "json", data: attrs });
    } else if (type === "onebot:xml") {
      await this.flush();
      this.children.push({ type: "xml", data: attrs });
    } else if (type === "onebot:cardimage") {
      await this.flush();
      this.children.push({ type: "cardimage", data: attrs });
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
      this.children.push({ type: "reply", data: attrs });
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
