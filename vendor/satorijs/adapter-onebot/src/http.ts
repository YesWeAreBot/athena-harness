import { createHmac } from "node:crypto";

import type {} from "@cordisjs/plugin-http";
import type { Server } from "@cordisjs/plugin-server";
import { Context } from "cordis";

import type { OneBotBot } from "./bot";
import type { Payload } from "./types";
import { dispatchSession } from "./utils";

export class OneBotHttpServer {
  constructor(
    public ctx: Context,
    public bot: OneBotBot,
  ) {}

  async connect() {
    const server = this.ctx.get("server") as Server | undefined;
    if (!server) {
      throw new Error("adapter-onebot http mode requires @cordisjs/plugin-server");
    }

    const config = this.bot.config;
    const { endpoint, token } = config;

    // Set up outgoing HTTP request method for Internal
    if (endpoint) {
      const http = this.ctx.http.extend({
        baseUrl: endpoint,
        headers: token ? { Authorization: `Token ${token}` } : {},
      });

      this.bot.internal._request = async (action, params) => {
        return http.post("/" + action, params);
      };
    }

    // Set up incoming webhook for events
    const path = config.path || "/onebot";
    const { secret } = config;

    server.post(path, async (req) => {
      if (secret) {
        const signature = req.headers.get("x-signature");
        if (!signature) return new Response(null, { status: 401 });

        const body = await req.text();
        const sig = createHmac("sha1", secret).update(body).digest("hex");
        if (signature !== `sha1=${sig}`) return new Response(null, { status: 403 });

        const parsed = JSON.parse(body) as Payload;
        const selfId = req.headers.get("x-self-id");
        if (selfId && selfId !== this.bot.selfId) return new Response(null, { status: 403 });

        this.bot.ctx.logger("onebot").debug("[receive] %o", parsed);
        dispatchSession(this.bot, parsed);
        return new Response(null, { status: 204 });
      }

      const body = (await req.json()) as Payload;
      const selfId = req.headers.get("x-self-id");
      if (selfId && selfId !== this.bot.selfId) return new Response(null, { status: 403 });

      this.bot.ctx.logger("onebot").debug("[receive] %o", body);
      dispatchSession(this.bot, body);
      return new Response(null, { status: 204 });
    });

    await this.bot.initialize();
  }
}
