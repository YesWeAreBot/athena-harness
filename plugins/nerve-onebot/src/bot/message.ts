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
    const messageId = this.isDirect
      ? String(await this.body.internal.sendPrivateForwardMsg(this.channelId.slice(PRIVATE_PFX.length), this.stack[0].children))
      : String(await this.body.internal.sendGroupForwardMsg(this.channelId, this.stack[0].children));
    this.results.push({ id: messageId });

    // Dispatch send event
    this.body.dispatch(
      this.body.session({
        type: "send",
        channel: { id: this.channelId, type: this.isDirect ? 1 : 0 },
        user: { id: this.body.selfId },
        message: { id: messageId },
      }),
    );
  }

  async flush(): Promise<void> {
    // Trim leading whitespace
    while (this.children.length > 0) {
      const first = this.children[0];
      if (first.type !== "text") break;
      first.data.text = first.data.text.trimStart();
      if (first.data.text) break;
      this.children.shift();
    }

    // Trim trailing whitespace
    while (this.children.length > 0) {
      const last = this.children[this.children.length - 1];
      if (last.type !== "text") break;
      last.data.text = last.data.text.trimEnd();
      if (last.data.text) break;
      this.children.pop();
    }

    const { type, author } = this.stack[0];
    if (!this.children.length && !author.messageId) return;

    if (type === "forward") {
      // Building forward message nodes
      if (author.messageId) {
        this.stack[1].children.push({ type: "node", data: { id: author.messageId } });
      } else {
        this.stack[1].children.push({
          type: "node",
          data: {
            name: author.name || this.body.user?.name || "",
            uin: author.id || this.body.selfId,
            content: this.children.map((code) => CQCode.encode(code.type, code.data)).join(""),
            time: `${Math.floor((+(author.time || 0) || Date.now()) / 1000)}`,
          },
        });
      }
      this.children = [];
      return;
    }

    // Normal message send
    try {
      const messageId = this.isDirect
        ? String(await this.body.internal.sendPrivateMsg(this.channelId.slice(PRIVATE_PFX.length), this.children))
        : String(await this.body.internal.sendGroupMsg(this.channelId, this.children));
      this.results.push({ id: messageId });

      // Dispatch send event
      this.body.dispatch(
        this.body.session({
          type: "send",
          channel: { id: this.channelId, type: this.isDirect ? 1 : 0 },
          user: { id: this.body.selfId },
          message: { id: messageId },
        }),
      );
    } catch (error) {
      this.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    this.children = [];
  }

  private async sendFile(attrs: Record<string, string>): Promise<void> {
    const src: string = attrs.src || attrs.url;
    const name = attrs.title || src.split("/").pop() || "file";
    const file = src.startsWith("file:") ? src.replace(/^file:\/\//, "") : await this.body.internal.downloadFile(src);
    try {
      if (this.isDirect) {
        await this.body.internal.uploadPrivateFile(this.channelId.slice(PRIVATE_PFX.length), file, name);
      } else {
        await this.body.internal.uploadGroupFile(this.channelId, file, name);
      }
      this.results.push({ id: "" });
      // File upload APIs do not return a message_id; dispatch the send event
      // with an empty id (koishi parity).
      this.body.dispatch(
        this.body.session({
          type: "send",
          channel: { id: this.channelId, type: this.isDirect ? 1 : 0 },
          user: { id: this.body.selfId },
          message: { id: "" },
        }),
      );
    } catch (error) {
      this.errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async visit(element: Element): Promise<void> {
    const { type, attrs, children } = element;

    switch (type) {
      case "text":
        this.text(String(attrs.content ?? ""));
        break;

      case "br":
        this.text("\n");
        break;

      case "p": {
        const prev = this.children[this.children.length - 1];
        if (prev?.type === "text" && !prev.data.text.endsWith("\n")) {
          prev.data.text += "\n";
        } else if (!prev) {
          this.text("\n");
        }
        await this.render(children ?? []);
        this.text("\n");
        break;
      }

      case "at":
        if (attrs.type === "all") {
          this.children.push({ type: "at", data: { qq: "all" } });
        } else {
          this.children.push({ type: "at", data: { qq: String(attrs.id ?? ""), name: attrs.name ? String(attrs.name) : "" } });
        }
        break;

      case "sharp":
        if (attrs.id) this.text(String(attrs.id));
        break;

      case "face":
        if (attrs.platform && attrs.platform !== this.body.platform) {
          await this.render(children ?? []);
        } else {
          this.children.push({ type: "face", data: { id: String(attrs.id ?? "") } });
        }
        break;

      case "a":
        await this.render(children ?? []);
        if (attrs.href) this.text(`（${attrs.href}）`);
        break;

      case "img":
      case "image": {
        const file = String(attrs.src || attrs.url || "");
        const cap = /^data:([\w/.+-]+);base64,/.exec(file);
        const finalFile = cap ? `base64://${file.slice(cap[0].length)}` : file;
        this.children.push({ type: "image", data: { file: finalFile, cache: attrs.cache ? "1" : "0" } });
        break;
      }

      case "video":
      case "audio": {
        await this.flush();
        const mediaType = type === "audio" ? "record" : "video";
        const file = String(attrs.src || attrs.url || "");
        const cap = /^data:([\w/.+-]+);base64,/.exec(file);
        const finalFile = cap ? `base64://${file.slice(cap[0].length)}` : file;
        this.children.push({ type: mediaType, data: { file: finalFile } });
        break;
      }

      case "file":
        await this.flush();
        // SAFETY: element attrs are string-keyed dictionaries; sendFile only reads string fields.
        await this.sendFile(attrs as Record<string, string>);
        break;

      case "quote":
        await this.flush();
        this.children.push({ type: "reply", data: { id: String(attrs.id ?? "") } });
        break;

      case "author":
        Object.assign(this.stack[0].author, attrs);
        break;

      case "figure":
        await this.flush();
        this.stack.unshift(new State("forward"));
        await this.render(children ?? []);
        await this.flush();
        this.stack.shift();
        await this.forward();
        break;

      case "message":
        await this.flush();
        if ("forward" in attrs) {
          this.stack.unshift(new State("forward"));
          await this.render(children ?? []);
          await this.flush();
          this.stack.shift();
          await this.forward();
        } else if ("id" in attrs) {
          this.stack[0].author.messageId = String(attrs.id);
        } else {
          if (attrs.userId) this.stack[0].author.id = String(attrs.userId);
          if (attrs.username || attrs.nickname) this.stack[0].author.name = String(attrs.username ?? attrs.nickname ?? "");
          if (attrs.time) {
            // SAFETY: `time` may be a numeric or string timestamp; Author.time accepts both.
            this.stack[0].author.time = attrs.time as string | number;
          }
          await this.render(children ?? []);
          await this.flush();
        }
        break;

      // OneBot-specific elements (onebot:music, onebot:tts, onebot:poke, ...)
      default:
        if (type.startsWith("onebot:")) {
          await this.flush();
          // SAFETY: element attrs are string-keyed dictionaries; CQCode data is Record<string, string>.
          this.children.push({ type: type.slice("onebot:".length), data: attrs as Record<string, string> });
          return;
        }
        // Recurse into unknown elements
        await this.render(children ?? []);
        break;
    }
  }
}
