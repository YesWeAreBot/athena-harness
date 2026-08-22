import { createReadStream } from "node:fs";
import { extname } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";

import { Schema } from "@athena-ai/core";
import type { JsonObject, MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "@athena-ai/protocol";
import type {} from "@cordisjs/plugin-server";
import type { Client } from "@cordisjs/plugin-webui";
import { type Context, Service } from "cordis";

import type { DeleteMessagePayload, LifeListPayload, ResponsePayload, SendMessagePayload } from "./shared";

export { SandboxBot } from "./bot";
export { SandboxMessenger } from "./message";
export * from "./shared";

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

export const Config: Schema<Config> = Schema.object({
  fileServer: Schema.object({
    enabled: Schema.boolean()
      .default(false)
      .description(
        "Serve local files referenced by `file:` urls. This exposes arbitrary files " +
          "readable by the process — never enable it on a publicly reachable deployment.",
      ),
  }),
});

/** Minimal content-type table for the resources a sandbox chat can render. */
const MIME_TYPES = new Map(
  Object.entries({
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
  }),
);

/** Marker used to tunnel retractions through the Nerve's `dispatch` method. */
const DELETE_PREFIX = "__delete:";

/**
 * Sandbox Hub: the global service that owns the WebUI page and the browser
 * WebSocket protocol.
 *
 * The Hub holds no Satori state of its own. Each Life installs a
 * `@athena-ai/sandbox-nerve` inside its isolated group; the Nerve registers
 * here under a `lifeId`, and the Hub routes every browser frame to the Nerve
 * the frame names. That keeps one sandbox page able to drive many Lives
 * without their Satori domains colliding.
 */
export default class SandboxHub extends Service<Config> implements SandboxHubService {
  public static readonly name = "sandbox";
  public static readonly inject = ["webui"];
  public static readonly Config = Config;

  private _nerves = new Map<string, SandboxNerveHandle>();
  /** `clientId` → `lifeId` → platforms the tab has driven, for teardown. */
  private _tabs = new Map<string, Map<string, Set<string>>>();
  private _fileBase: string | undefined;

  /** Base url of the file server, surfaced to Nerves via the service. */
  get fileBase(): string | undefined {
    return this._fileBase;
  }

  constructor(
    ctx: Context,
    public config: Config,
  ) {
    super(ctx, "sandbox");
  }

  // ---------------------------------------------------------------------------
  // SandboxHubService implementation
  // ---------------------------------------------------------------------------

  register(lifeId: string, nerve: SandboxNerveHandle): () => void {
    if (this._nerves.has(lifeId)) {
      throw new Error(`Sandbox: Life already registered: ${lifeId}`);
    }
    this._nerves.set(lifeId, nerve);
    this._broadcastLifeList();
    return () => {
      this._nerves.delete(lifeId);
      this._broadcastLifeList();
    };
  }

  lives(): { id: string; meta: SandboxNerveHandle["meta"] }[] {
    return [...this._nerves.entries()].map(([id, n]) => ({ id, meta: n.meta }));
  }

  // ---------------------------------------------------------------------------
  // Service lifecycle
  // ---------------------------------------------------------------------------

  *[Service.init]() {
    const ctx = this.ctx;

    ctx.webui.addEntry({
      baseUrl: import.meta.url,
      source: "../client/index.ts",
      manifest: "../dist/manifest.json",
      routes: ["/sandbox"],
    });

    this._setupListeners();
    this._setupFileServer();
    yield;
  }

  // ---------------------------------------------------------------------------
  // Internal: WebSocket listeners
  // ---------------------------------------------------------------------------

  private _setupListeners() {
    const ctx = this.ctx;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    const listen = <T>(type: string, listener: (this: Client, body: T) => void): void => {
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

    /**
     * Build a sink that stamps `lifeId` on every frame the Nerve emits, so the
     * page can route replies back to the right conversation.
     */
    const sinkFor = (client: Client, lifeId: string): MessageSink => ({
      send: (frame) => {
        // SAFETY: frame.body comes from this Hub's own frame construction and is always an object.
        client.send({
          type: frame.type,
          body: { ...(frame.body as JsonObject), lifeId },
        } as never);
      },
    });

    const nerveFor = (lifeId: string): SandboxNerveHandle => {
      const nerve = self._nerves.get(lifeId);
      if (!nerve) {
        throw new Error(`[sandbox] no Life registered as '${lifeId}'. ` + "Install @athena-ai/sandbox-nerve inside the Life's group.");
      }
      return nerve;
    };

    /** Route a browser frame to the Nerve it names, remembering the tab. */
    const forward = async (client: Client, lifeId: string, platform: string, payload: Omit<SandboxDispatchPayload, "clientId" | "platform" | "sink">) => {
      const nerve = nerveFor(lifeId);
      self._trackTab(client.id, lifeId, platform);
      await nerve.dispatch({
        ...payload,
        clientId: client.id,
        platform,
        sink: sinkFor(client, lifeId),
      });
    };

    listen("sandbox/send-message", async function (body: SendMessagePayload) {
      const { lifeId, platform, user, channel, content, quote } = body;
      await forward(this, lifeId, platform, { user, channel, content, quote });
    });

    listen("sandbox/delete-message", async function (body: DeleteMessagePayload) {
      const { lifeId, platform, user, channel, messageId } = body;
      await forward(this, lifeId, platform, { user, channel, content: `${DELETE_PREFIX}${messageId}` });
    });

    listen("sandbox/response", async function (body: ResponsePayload) {
      const { lifeId, platform, nonce, data } = body;
      await nerveFor(lifeId).request("settle", { platform, nonce, data });
    });

    // `webui/connection` fires on connect and disconnect alike; a connecting
    // client is still in the registry, so use that to tell them apart.
    ctx.on("webui/connection", (client) => {
      if (ctx.webui.clients[client.id]) {
        client.send({ type: "sandbox/life-list", body: self._lifeListPayload() });
        return;
      }
      void self._releaseTab(client.id);
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: Tab bookkeeping
  // ---------------------------------------------------------------------------

  private _trackTab(clientId: string, lifeId: string, platform: string) {
    let byLife = this._tabs.get(clientId);
    if (!byLife) this._tabs.set(clientId, (byLife = new Map()));
    let platforms = byLife.get(lifeId);
    if (!platforms) byLife.set(lifeId, (platforms = new Set()));
    platforms.add(platform);
  }

  /** Tell every Nerve this tab talked to that its bots can go away. */
  private async _releaseTab(clientId: string) {
    const byLife = this._tabs.get(clientId);
    if (!byLife) return;
    this._tabs.delete(clientId);
    for (const [lifeId, platforms] of byLife) {
      const nerve = this._nerves.get(lifeId);
      if (!nerve) continue;
      for (const platform of platforms) {
        await nerve.release({ clientId, platform });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: Broadcast helpers
  // ---------------------------------------------------------------------------

  private _lifeListPayload(): LifeListPayload {
    return {
      lives: this.lives().map(({ id, meta }) => ({
        id,
        name: meta.name,
        description: meta.description,
      })),
    };
  }

  private _broadcastLifeList() {
    const payload = this._lifeListPayload();
    for (const client of Object.values(this.ctx.webui.clients)) {
      client.send({ type: "sandbox/life-list", body: payload });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: File server
  // ---------------------------------------------------------------------------

  private _setupFileServer() {
    if (!this.config.fileServer.enabled) return;
    const ctx = this.ctx;

    ctx.inject(["server"], (ctx) => {
      ctx.server.get(FILE_ROUTE, async (req, res) => {
        const url = req.query.get("url");
        if (!url?.startsWith("file:")) {
          res.status = 400;
          res.text("expected a `file:` url");
          return;
        }
        res.headers.set("content-type", MIME_TYPES.get(extname(url).toLowerCase()) ?? "application/octet-stream");
        // SAFETY: Node's Readable.toWeb returns a ReadableStream<any>; this stream emits file bytes.
        res.body = Readable.toWeb(createReadStream(fileURLToPath(url))) as ReadableStream<Uint8Array>;
      });

      this._fileBase = ctx.server.baseUrl + FILE_ROUTE;
      ctx.effect(
        () => () => {
          this._fileBase = undefined;
        },
        "sandbox.fileBase",
      );
    });
  }
}
