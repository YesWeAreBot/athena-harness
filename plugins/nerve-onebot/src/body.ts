import { Body } from "@athena-ai/protocol";
import type { Channel, Message } from "@athena-ai/protocol-im";
import type { Element } from "@cordisjs/element";
import type {} from "@cordisjs/plugin-http";
import { Context } from "cordis";
import Schema from "schemastery";

import { adaptMessage, dispatchEvent, PRIVATE_PFX } from "./adapter.js";
import { OneBotMessageEncoder } from "./encoder.js";
import * as OneBot from "./types.js";
import type { OneBotSocket } from "./ws.js";

interface IncomingEnvelope {
  post_type?: string;
  echo?: number;
}

function parseEnvelope(raw: string): IncomingEnvelope | undefined {
  try {
    const parsed = JSON.parse(raw);
    return Object.prototype.toString.call(parsed) === "[object Object]" ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class OneBotBody extends Body<OneBotBody.Config> {
  static inject = ["nerve", "http"];
  static schema = true as const;

  platform = "onebot";
  public internal: OneBot.Internal;
  private _ws?: OneBotSocket;
  private _dispose?: () => void;

  constructor(ctx: Context, config: OneBotBody.Config) {
    super(ctx, config);
    this.selfId = config.selfId;
    this.internal = new OneBot.Internal(this);
  }
  *[Symbol.for("cordis.init")]() {
    this._dispose = this.ctx.nerve.register(this);
    void this.connect().catch((error) => {
      this.offline();
      this.ctx.logger("nerve-onebot").error("Connection failed:", error);
    });
    yield () => {
      this._dispose?.();
      this._dispose = undefined;
      void this.disconnect();
    };
  }

  async connect(): Promise<void> {
    this.status = "connecting";
    const http = this.ctx.get("http");
    if (!http) throw new Error("OneBotBody requires @cordisjs/plugin-http");
    const url = new URL(this.config.endpoint ?? "ws://127.0.0.1:6700");
    if (this.config.token) url.searchParams.set("access_token", this.config.token);
    // SAFETY: @cordisjs/plugin-http returns the WebSocket-compatible transport declared by this adapter.
    const ws = http.ws(url.href) as OneBotSocket;
    this._ws = ws;
    let counter = 0;
    const listeners = new Map<number, (response: OneBot.Response) => void>();
    const logger = this.ctx.logger("nerve-onebot");

    ws.addEventListener("message", (event) => {
      const raw = event.data.toString();
      const parsed = parseEnvelope(raw);
      if (!parsed) {
        logger.warn("cannot parse message", raw);
        return;
      }
      if (parsed.post_type) {
        // SAFETY: dispatchEvent narrows the supported OneBot post types before using message-only fields.
        dispatchEvent(this, parsed as OneBot.Payload);
      } else if (parsed.echo !== undefined && Number.isInteger(parsed.echo)) {
        const resolve = listeners.get(parsed.echo);
        if (resolve) {
          listeners.delete(parsed.echo);
          // SAFETY: echo identifies a response that was created by this adapter's internal request transport.
          resolve(parsed as OneBot.Response);
        }
      }
    });

    ws.addEventListener("close", () => {
      this.internal._request = undefined;
      this.offline();
    });

    this.internal._request = (action, params) => {
      const echo = ++counter;
      return new Promise<OneBot.Response>((resolve, reject) => {
        listeners.set(echo, resolve);
        const timer = setTimeout(() => {
          listeners.delete(echo);
          reject(new Error(`OneBot API timeout: ${action}`));
        }, this.config.responseTimeout ?? 30000);
        const dispose = () => clearTimeout(timer);
        listeners.set(echo, (response) => {
          dispose();
          resolve(response);
        });
        ws.send(JSON.stringify({ action, params, echo }));
      });
    };

    const login = await this.internal.getLoginInfo();
    this.selfId = String(login.user_id);
    this.online();
  }

  async disconnect(): Promise<void> {
    this.status = "disconnecting";
    this._ws?.close();
    this._ws = undefined;
    this.internal._request = undefined;
    this.offline();
  }

  async sendMessage(channelId: string, content: Element[]): Promise<Message[]> {
    const encoder = new OneBotMessageEncoder(this, channelId);
    return encoder.send(content);
  }

  async sendPrivateMessage(userId: string, content: Element[]): Promise<string[]> {
    const channel = await this.createDirectChannel(userId);
    const messages = await this.sendMessage(channel.id, content);
    return messages.map((message) => message.id);
  }

  async getMessage(_channelId: string, messageId: string): Promise<Message> {
    return adaptMessage(await this.internal.getMsg(messageId));
  }

  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `${PRIVATE_PFX}${userId}`, type: 1 };
  }
}

export namespace OneBotBody {
  export interface Config {
    selfId: string;
    endpoint?: string;
    token?: string;
    responseTimeout?: number;
  }

  export const Config: Schema<Config> = Schema.object({
    selfId: Schema.string().required().description("Bot QQ 号"),
    endpoint: Schema.string().default("ws://127.0.0.1:6700").description("OneBot WebSocket 地址"),
    token: Schema.string().description("访问令牌"),
    responseTimeout: Schema.natural().default(30000).description("API 响应超时（毫秒）"),
  });
}
