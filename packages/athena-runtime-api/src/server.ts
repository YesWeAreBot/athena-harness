import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

import { consoleDir as defaultConsoleDir } from "@yesimbot/athena-console";

export interface LifeInput {
  readonly id: string;
  readonly mode?: string;
  readonly bodies?: readonly string[];
}

export interface RuntimeApiManager {
  status(): unknown;
  listLives(): unknown;
  createLife(input: LifeInput): Promise<unknown>;
  removeLife(id: string): Promise<boolean>;
  listBodies(): unknown;
  listModes(): unknown;
  listPipelines(): unknown;
}

export interface RuntimeApiOptions {
  readonly manager: RuntimeApiManager;
  readonly token?: string;
  readonly consoleDir?: string;
}

export function createRuntimeApiServer(options: RuntimeApiOptions): Server {
  const { manager, token } = options;
  const consoleDir = options.consoleDir ?? defaultConsoleDir;

  return createServer((req, res) => {
    void handleRequest().catch((error: unknown) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });

    async function handleRequest(): Promise<void> {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        if (token && req.headers.authorization !== `Bearer ${token}`) {
          sendJson(res, 401, { error: "Unauthorized" });
          return;
        }
        await handleApi(req, res, url, manager);
        return;
      }
      await serveStatic(res, consoleDir, url.pathname);
    }
  });
}

async function handleApi(req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse, url: URL, manager: RuntimeApiManager): Promise<void> {
  const path = url.pathname.replace(/^\/api/, "");
  if (req.method === "GET" && path === "/status") {
    sendJson(res, 200, manager.status());
    return;
  }
  if (req.method === "GET" && path === "/lives") {
    sendJson(res, 200, manager.listLives());
    return;
  }
  if (req.method === "POST" && path === "/lives") {
    const body = (await readBody(req)) as LifeInput;
    sendJson(res, 201, await manager.createLife(body));
    return;
  }
  const lifeMatch = /^\/lives\/([^/]+)$/.exec(path);
  if (req.method === "DELETE" && lifeMatch) {
    sendJson(res, 200, { removed: await manager.removeLife(decodeURIComponent(lifeMatch[1]!)) });
    return;
  }
  if (req.method === "GET" && path === "/bodies") {
    sendJson(res, 200, manager.listBodies());
    return;
  }
  if (req.method === "GET" && path === "/modes") {
    sendJson(res, 200, manager.listModes());
    return;
  }
  if (req.method === "GET" && path === "/pipelines") {
    sendJson(res, 200, manager.listPipelines());
    return;
  }
  sendJson(res, 404, { error: `Not found: ${req.method} ${url.pathname}` });
}

async function serveStatic(res: import("node:http").ServerResponse, root: string, pathname: string): Promise<void> {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  if (safePath.includes("..")) {
    sendText(res, 403, "Forbidden");
    return;
  }
  const target = join(root, safePath);
  const mime = safePath.endsWith(".html") ? "text/html; charset=utf-8" : safePath.endsWith(".js") ? "text/javascript; charset=utf-8" : safePath.endsWith(".css") ? "text/css; charset=utf-8" : "application/octet-stream";
  try {
    sendText(res, 200, await readFile(target, "utf8"), mime);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function readBody(req: import("node:http").IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: import("node:http").ServerResponse, status: number, value: unknown): void {
  sendText(res, status, JSON.stringify(value), "application/json; charset=utf-8");
}

function sendText(res: import("node:http").ServerResponse, status: number, text: string, contentType = "text/plain; charset=utf-8"): void {
  res.writeHead(status, { "content-type": contentType });
  res.end(text);
}
