import type { WebSocket } from "@athena-ai/protocol-im";
import { WsClient } from "@athena-ai/protocol-im";
import type {} from "@cordisjs/plugin-http";
import type { Context } from "cordis";

import type { OneBotBody } from "./bot/index.js";
import type { Payload, Response } from "./types.js";
import { TimeoutError } from "./types.js";
import { dispatchSession } from "./utils.js";

/**
 * Minimal shape of the server service routes used by this adapter.
 * Provided by @cordisjs/plugin-server.
 */
interface ServerLike {
  ws(path: string, handler: (req: RequestLike, accept: () => Promise<WebSocket>) => void): void;
}

interface RequestLike {
  headers: Record<string, string | undefined>;
}

/**
 * Cast a platform socket object to the adapter's WebSocket shape.
 * SAFETY: both @cordisjs/plugin-http and the server plugin return
 * WebSocket-compatible objects (addEventListener/send/close/readyState).
 */
// SAFETY: the value originates from a known WebSocket-returning API (@cordisjs/plugin-http or plugin-server).
// oxlint-disable-next-line anti-slop/no-unknown-parameters
function toWebSocket(value: unknown): WebSocket {
  // SAFETY: caller guarantees the value is a WebSocket-compatible object from a known API.
  return value as WebSocket;
}

// ─── Module-level request/response bridge (koishi pattern) ──────────────────

let counter = 0;
const listeners: Record<number, (response: Response) => void> = {};

export function accept(socket: WebSocket, body: OneBotBody): void {
  const logger = body.ctx.logger("onebot");

  socket.addEventListener("message", (event) => {
    let parsed: any;
    const data = String(event.data);
    try {
      parsed = JSON.parse(data);
    } catch {
      return logger.warn("cannot parse message", data);
    }

    if ("post_type" in parsed) {
      logger.debug("[receive] %o", parsed);
      // SAFETY: presence of `post_type` marks an incoming OneBot event payload.
      void dispatchSession(body, parsed as Payload).catch((error) => {
        logger.warn("failed to dispatch event:", error);
      });
    } else if (parsed.echo in listeners) {
      listeners[parsed.echo](parsed);
      delete listeners[parsed.echo];
    }
  });

  socket.addEventListener("close", () => {
    delete body.internal._request;
    body.offline();
  });

  body.internal._request = (action, params) => {
    const data = { action, params, echo: ++counter };
    return new Promise((resolve, reject) => {
      listeners[data.echo] = resolve;
      setTimeout(() => {
        delete listeners[data.echo];
        reject(new TimeoutError(params, action));
      }, body.config.responseTimeout);
      socket.send(JSON.stringify(data));
    });
  };

  body.initialize();
}

// ─── WebSocket Client ───────────────────────────────────────────────────────

export class OneBotWsClient extends WsClient<OneBotBody> {
  protected getActive(): boolean {
    return this.body.isActive;
  }

  protected setStatus(status: OneBotBody["status"], error?: Error): void {
    this.body.status = status;
    this.body.error = error;
  }

  protected prepare(): Promise<WebSocket> {
    // SAFETY: WsClient is only instantiated when protocol === "ws", guaranteeing WsClientOptions shape.
    const config = this.body.config as OneBotBody.BaseConfig & OneBotBody.WsClientOptions;
    const url = new URL(config.endpoint || "ws://127.0.0.1:6700");
    if (this.body.config.token) {
      url.searchParams.set("access_token", this.body.config.token);
    }
    return Promise.resolve(toWebSocket(this.ctx.http.ws(url.href)));
  }

  protected accept(socket: WebSocket): void {
    accept(socket, this.body);
  }
}

// ─── WebSocket Server (reverse) ─────────────────────────────────────────────

export class OneBotWsServer {
  constructor(ctx: Context, body: OneBotBody) {
    // SAFETY: ctx.get("server") returns the server service or undefined; cast narrows to our minimal interface.
    const server = ctx.get("server") as ServerLike | undefined;
    if (!server) {
      throw new Error("nerve-onebot ws-reverse mode requires @cordisjs/plugin-server");
    }

    const logger = ctx.logger("onebot");
    // SAFETY: WsServer is only instantiated when protocol === "ws-reverse", guaranteeing WsServerOptions shape.
    const config = body.config as OneBotBody.BaseConfig & OneBotBody.WsServerOptions;
    const path = config.path || "/onebot";
    server.ws(path, async (req, accept_) => {
      logger.debug("connected with", req.headers);
      if (req.headers["x-client-role"] !== "Universal") {
        return;
      }
      const selfId = req.headers["x-self-id"]?.toString();
      if (selfId && selfId !== body.selfId) return;

      const socket = toWebSocket(await accept_());
      accept(socket, body);
    });
  }
}
