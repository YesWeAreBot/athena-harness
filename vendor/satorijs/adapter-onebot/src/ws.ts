import type {} from "@cordisjs/plugin-http";
import type { Server } from "@cordisjs/plugin-server";
import { WsClient } from "@satorijs/core";
import { Context } from "cordis";

import type { OneBotBot } from "./bot";
import type { Payload, Response } from "./types";
import { dispatchSession, TimeoutError } from "./utils";

let counter = 0;
const listeners: Record<number, (response: Response) => void> = {};

function handleSocket(socket: WebSocket, bot: OneBotBot) {
  const logger = bot.ctx.logger("onebot");

  socket.addEventListener("message", (event) => {
    let parsed: unknown;
    const data = event.data.toString();
    try {
      parsed = JSON.parse(data);
    } catch {
      logger.warn("cannot parse message", data);
      return;
    }

    if (typeof parsed !== "object" || parsed === null) return;

    if ("post_type" in parsed) {
      logger.debug("[receive] %o", parsed);
      dispatchSession(bot, parsed as Payload);
    } else if ("echo" in parsed) {
      const record = parsed as Record<string, unknown>;
      const echo = record.echo as number;
      if (echo in listeners) {
        listeners[echo]!(parsed as Response);
        delete listeners[echo];
      }
    }
  });

  socket.addEventListener("close", () => {
    delete bot.internal._request;
    bot.offline();
  });

  bot.internal._request = (action, params) => {
    const echo = ++counter;
    const payload = { action, params, echo };
    const { promise, resolve, reject } = Promise.withResolvers<Response>();
    listeners[echo] = resolve;
    setTimeout(() => {
      delete listeners[echo];
      reject(new TimeoutError(params, action));
    }, bot.config.responseTimeout);
    socket.send(JSON.stringify(payload));
    return promise;
  };

  bot.initialize();
}

export class OneBotWsClient extends WsClient<OneBotBot> {
  prepare() {
    const url = new URL(this.bot.config.endpoint || "ws://127.0.0.1:6700");
    if (this.bot.config.token) {
      url.searchParams.set("access_token", this.bot.config.token);
    }
    return this.ctx.http.ws(url.href);
  }

  accept(socket: WebSocket) {
    handleSocket(socket, this.bot);
  }
}

export class OneBotWsServer {
  constructor(
    public ctx: Context,
    public bot: OneBotBot,
  ) {
    const server = ctx.get("server") as Server | undefined;
    if (!server) {
      throw new Error("adapter-onebot ws-reverse mode requires @cordisjs/plugin-server");
    }

    const path = bot.config.path || "/onebot";
    server.ws(path, async (req, accept) => {
      const selfId = req.headers.get("x-self-id");
      if (selfId && selfId !== bot.selfId) return;

      const socket = await accept();
      handleSocket(socket as unknown as WebSocket, bot);
    });
  }
}
