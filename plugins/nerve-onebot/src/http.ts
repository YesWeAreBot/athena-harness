import { createHmac } from "node:crypto";

import type {} from "@cordisjs/plugin-http";
import type { Context } from "cordis";

import type { OneBotBody } from "./bot/index.js";
import type { Payload, Response } from "./types.js";
import { dispatchEvent } from "./utils.js";

/**
 * HTTP-based OneBot connection.
 * Posts API calls to the endpoint; receives events via HTTP POST webhook.
 */
export class OneBotHttpServer {
  constructor(
    private ctx: Context,
    private body: OneBotBody,
  ) {}

  async connect(): Promise<void> {
    const { endpoint, token, secret, path = "/onebot" } = this.body.config;

    // Set up outgoing API requests
    if (endpoint) {
      const http = this.ctx.http;
      this.body.internal._request = async (action, params) => {
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Token ${token}`;
        const response = await http.post(`${endpoint}/${action}`, params, { headers });
        // SAFETY: OneBot HTTP API returns the response body directly, which matches the Response shape.
        return response as Response;
      };
    }

    // Set up incoming webhook
    // SAFETY: the server service exposes `post` when @cordisjs/plugin-server is installed; checked below.
    const server = this.ctx.get("server") as
      | { post?(path: string, handler: (ctx: { headers: Record<string, string>; body: unknown; status: number }) => void): void }
      | undefined;
    if (!server?.post) {
      throw new Error("nerve-onebot http mode requires @cordisjs/plugin-server for receiving events");
    }

    server.post(path, (req) => {
      if (secret) {
        const signature = req.headers["x-signature"];
        if (!signature) {
          req.status = 401;
          return;
        }
        const sig = createHmac("sha1", secret).update(JSON.stringify(req.body)).digest("hex");
        if (signature !== `sha1=${sig}`) {
          req.status = 403;
          return;
        }
      }

      const selfId = req.headers["x-self-id"]?.toString();
      if (selfId && selfId !== this.body.selfId) {
        req.status = 403;
        return;
      }

      this.ctx.logger("onebot").debug("[receive] %o", req.body);
      // SAFETY: the webhook body is a OneBot event payload; malformed payloads are ignored by dispatchEvent.
      void dispatchEvent(this.body, req.body as Payload).catch((error) => {
        this.ctx.logger("onebot").warn("failed to dispatch event:", error);
      });
      req.status = 204;
    });

    await this.body.initialize();
  }
}
