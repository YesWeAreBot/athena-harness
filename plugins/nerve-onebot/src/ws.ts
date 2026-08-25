import type { WebSocket } from "@athena-ai/protocol-im";
import { WsClient } from "@athena-ai/protocol-im";
import type {} from "@cordisjs/plugin-http";
import type { Context } from "cordis";

import type { OneBotBody } from "./bot/index.js";
import type { Response } from "./types.js";
import { dispatchEvent } from "./utils.js";

/**
 * Minimal shape of the server service routes used by this adapter.
 * Provided by @cordisjs/plugin-server.
 */
interface ServerLike {
  ws(path: string, handler: (req: RequestLike, accept: () => Promise<WebSocket>) => void): void;
  post?(path: string, handler: (req: RequestLike) => void): void;
}

interface RequestLike {
  headers: Record<string, string | undefined>;
}

/**
 * Parse a raw WebSocket message into a JSON object, or return null.
 * This is the I/O boundary for incoming socket data: the payload arrives as
 * `unknown` from the network and is narrowed by parsing, so the anti-slop
 * "parse at the boundary" rules are satisfied by the try/parse below.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type
function parsePayload<T>(data: unknown): T | null {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- I/O boundary: socket data may be string or binary.
  const text = typeof data === "string" ? data : String(data);
  try {
    const parsed: unknown = JSON.parse(text);
    /* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type */
    if (typeof parsed === "object" && parsed !== null) {
      // SAFETY: JSON.parse returns a plain object for JSON object literals; the shape is verified by `in` checks at the call site.
      return parsed as T;
    }
    /* oxlint-enable anti-slop/no-runtime-typeof, anti-slop/no-unsafe-dictionary-type */
  } catch {
    // fall through to null
  }
  return null;
}

/**
 * Cast a platform socket object to the adapter's WebSocket shape.
 * SAFETY: both @cordisjs/plugin-http and the server plugin return
 * WebSocket-compatible objects (addEventListener/send/close/readyState).
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters
function toWebSocket(value: unknown): WebSocket {
  // SAFETY: the value originates from a known WebSocket-returning API.
  return value as WebSocket;
}

/**
 * Bind an established WebSocket to a body: route incoming events to the
 * adapter and install the request/response bridge on the body's internal.
 * Mirrors koishi onebot's `accept(socket, bot)`.
 */
export function acceptSocket(socket: WebSocket, body: OneBotBody): void {
  const logger = body.ctx.logger("onebot");

  socket.addEventListener("message", (event) => {
    const parsed = parsePayload<object>(event.data);
    if (!parsed) {
      logger.warn("cannot parse message", event.data);
      return;
    }

    if ("post_type" in parsed) {
      logger.debug("[receive] %o", parsed);
      // SAFETY: presence of `post_type` marks a OneBot event payload.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- narrowing parsed JSON to a known payload shape at the I/O boundary.
      void dispatchEvent(body, parsed as unknown as import("./types.js").Payload).catch((error) => {
        logger.warn("failed to dispatch event:", error);
      });
    } else if ("echo" in parsed) {
      // SAFETY: presence of `echo` marks an API response.
      // oxlint-disable-next-line anti-slop/no-chained-type-assertions -- narrowing parsed JSON to a known response shape at the I/O boundary.
      body.internal.accept(parsed as unknown as Response);
    }
  });

  socket.addEventListener("close", () => {
    delete body.internal._request;
    body.offline();
  });

  body.internal._request = (action, params) => {
    const payload = { action, params, echo: body.internal.nextEcho() };
    return body.internal.request(socket, payload);
  };

  body.initialize();
}

export class OneBotWsClient extends WsClient<OneBotBody> {
  protected getActive(): boolean {
    return this.body.isActive;
  }

  protected setStatus(status: OneBotBody["status"], error?: Error): void {
    this.body.status = status;
    this.body.error = error;
  }

  protected prepare(): Promise<WebSocket> {
    const url = new URL(this.body.config.endpoint || "ws://127.0.0.1:6700");
    if (this.body.config.token) {
      url.searchParams.set("access_token", this.body.config.token);
    }
    // SAFETY: @cordisjs/plugin-http returns a WebSocket-compatible object (synchronously).
    return Promise.resolve(toWebSocket(this.ctx.http.ws(url.href)));
  }

  protected accept(socket: WebSocket): void {
    acceptSocket(socket, this.body);
  }
}

export interface WsServerConfig {
  path?: string;
}

export class OneBotWsServer {
  constructor(ctx: Context, body: OneBotBody) {
    // SAFETY: `server` is provided by @cordisjs/plugin-server; checked below before use.
    const server = ctx.get("server") as ServerLike | undefined;
    if (!server) {
      throw new Error("nerve-onebot ws-reverse mode requires @cordisjs/plugin-server");
    }

    const path = body.config.path || "/onebot";
    server.ws(path, async (req, accept) => {
      const selfId = req.headers?.["x-self-id"];
      if (selfId && selfId !== body.selfId) return;

      // SAFETY: the server accept() resolves to a WebSocket-compatible object.
      const socket = toWebSocket(await accept());
      acceptSocket(socket, body);
    });
  }
}
