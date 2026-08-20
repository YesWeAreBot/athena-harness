import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import type {} from "@cordisjs/plugin-server";
import type { Client } from "@cordisjs/plugin-webui";
import { Universal } from "@satorijs/core";
import type { Context, Fiber } from "cordis";
import type { Dict } from "cosmokit";
import z from "schemastery";

import { SandboxBot } from "./bot";
import type { DeleteMessagePayload, Message, ResponsePayload, SendMessagePayload } from "./shared";

export { SandboxBot } from "./bot";
export { SandboxMessenger } from "./message";
export * from "./shared";

export const name = "sandbox";
export const inject = ["webui", "satori"];

/** Login id used by the harness inside every sandbox platform. */
export const SELF_ID = "athena";
/** Display name shown next to harness replies in the sandbox page. */
export const SELF_NAME = "Athena";

/** Route the sandbox file server is mounted on. */
const FILE_ROUTE = "/sandbox/file";

export interface Config {
  fileServer: {
    enabled: boolean;
  };
}

export const Config: z<Config> = z.object({
  fileServer: z.object({
    enabled: z
      .boolean()
      .default(false)
      .description(
        "Serve local files referenced by `file:` urls. This exposes arbitrary files " +
          "readable by the process — never enable it on a publicly reachable deployment.",
      ),
  }),
});

/** Minimal content-type table for the resources a sandbox chat can render. */
const MIME_TYPES: Record<string, string> = {
  ".aac": "audio/aac",
  ".flac": "audio/flac",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4a": "audio/mp4",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain",
  ".wav": "audio/wav",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

interface BotHandle {
  /** The WebUI client that owns this virtual platform. */
  client: Client;
  /** Fiber of the `SandboxBot` plugin, disposed when the client goes away. */
  fiber: Fiber;
  /** Resolves once the bot has been registered with Satori. */
  bot: Promise<SandboxBot>;
}

export function apply(ctx: Context, config: Config) {
  ctx.webui.addEntry({
    baseUrl: import.meta.url,
    source: "../client/index.ts",
    manifest: "../dist/manifest.json",
    routes: ["/sandbox"],
  });

  /**
   * Base url handed to bots so the messenger can rewrite `file:` resources.
   * Only populated while the optional file server is mounted.
   */
  let fileBase: string | undefined;

  const handles: Dict<BotHandle> = Object.create(null);

  /**
   * One bot per virtual platform. The page generates its platform id once and
   * keeps it in local storage, so reconnecting the same tab reuses the bot.
   */
  const ensureBot = (platform: string, client: Client): BotHandle => {
    const existing = handles[platform];
    if (existing) return existing;
    const fiber = ctx.plugin(SandboxBot, {
      platform,
      selfId: SELF_ID,
      selfName: SELF_NAME,
      client,
      fileBase,
    });
    const bot = (async () => {
      await fiber;
      const bot = ctx.satori.bots[`${platform}:${SELF_ID}`];
      if (!bot) throw new Error(`sandbox bot was not registered for platform ${platform}`);
      return bot as SandboxBot;
    })();
    return (handles[platform] = { client, fiber, bot });
  };

  const createEvent = (userId: string, channelId: string): Partial<Universal.Event> => {
    const isDirect = channelId === "@" + userId;
    return {
      user: { id: userId, name: userId },
      channel: {
        id: channelId,
        type: isDirect ? Universal.Channel.Type.DIRECT : Universal.Channel.Type.TEXT,
      },
      guild: isDirect ? undefined : { id: channelId },
      timestamp: Date.now(),
    };
  };

  // `ctx.webui.listeners` is a plain dictionary and is not fiber-scoped, so the
  // keys have to be reclaimed by hand when this plugin unloads.
  const listen = <T>(type: string, listener: (this: Client, body: T) => unknown) => {
    ctx.effect(
      () => {
        ctx.webui.listeners[type] = listener;
        return () => {
          delete ctx.webui.listeners[type];
        };
      },
      `webui.listeners[${JSON.stringify(type)}]`,
    );
  };

  listen("sandbox/send-message", async function (body: SendMessagePayload) {
    const { platform, user, channel, content, quote } = body;
    const bot = await ensureBot(platform, this).bot;
    const id = Math.random().toString(36).slice(2);
    this.send({
      type: "sandbox/message",
      body: { id, content, user, channel, platform, quote } satisfies Message,
    });
    const session = bot.session(createEvent(user, channel));
    session.type = "message";
    // `content` resets `event.message`, so it has to be assigned first.
    session.content = content;
    session.messageId = id;
    if (quote) session.quote = { id: quote.id, content: quote.content };
    bot.dispatch(session);
  });

  listen("sandbox/delete-message", async function (body: DeleteMessagePayload) {
    const { platform, user, channel, messageId } = body;
    const bot = await ensureBot(platform, this).bot;
    const session = bot.session(createEvent(user, channel));
    session.type = "message-deleted";
    session.messageId = messageId;
    bot.dispatch(session);
  });

  listen("sandbox/response", async function (body: ResponsePayload) {
    const handle = handles[body.platform];
    if (!handle) return;
    const bot = await handle.bot;
    bot.settle(body.nonce, body.data);
  });

  // `webui/connection` fires on both connect and disconnect; only a disconnect
  // has already removed the client from the registry.
  ctx.on("webui/connection", (client) => {
    if (ctx.webui.clients[client.id]) return;
    for (const [platform, handle] of Object.entries(handles)) {
      if (handle.client !== client) continue;
      delete handles[platform];
      handle.fiber.dispose();
    }
  });

  if (config.fileServer.enabled) {
    ctx.inject(["server"], (ctx) => {
      ctx.server.get(FILE_ROUTE, async (req, res) => {
        const url = req.query.get("url");
        if (!url?.startsWith("file:")) {
          res.status = 400;
          res.text("expected a `file:` url");
          return;
        }
        res.headers.set("content-type", MIME_TYPES[extname(url).toLowerCase()] ?? "application/octet-stream");
        // `Readable.toWeb` yields a web stream typed against Node's own globals;
        // the server accepts it as a `BodyInit`.
        res.body = Readable.toWeb(createReadStream(fileURLToPath(url))) as ReadableStream<Uint8Array>;
      });

      fileBase = ctx.server.baseUrl + FILE_ROUTE;
      ctx.effect(
        () => () => {
          fileBase = undefined;
        },
        "sandbox.fileBase",
      );
    });
  }
}
