import type { Body } from "@athena-ai/protocol";
import type { Context } from "cordis";
import type { Awaitable } from "cosmokit";

export interface WebSocket {
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "close", listener: (event: { code?: number; reason?: string }) => void): void;
  addEventListener(type: "error", listener: (event: { message?: string }) => void): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly url?: string;
}

export interface WsClientConfig {
  /** Max retry attempts on initial connection. */
  retryTimes: number;
  /** Retry interval (ms) on initial connection. */
  retryInterval: number;
  /** Retry interval (ms) after connection drops. */
  retryLazy: number;
}

export const DefaultWsClientConfig: WsClientConfig = {
  retryTimes: 6,
  retryInterval: 5000,
  retryLazy: 60000,
};

/**
 * WebSocket client with automatic reconnection.
 * Adapters extend this to implement platform-specific connection logic.
 *
 * Mirrors satori's `WsClientBase`: the subclass reports active state and
 * status transitions via `getActive` / `setStatus`, while this class owns
 * the retry state machine (initial retries vs. lazy reconnect after drops).
 */
export abstract class WsClient<B extends Body = Body> {
  protected socket?: WebSocket;
  protected connectionId = 0;

  constructor(
    public ctx: Context,
    public body: B,
    public config: WsClientConfig,
  ) {}

  /** Whether the body should keep the connection alive. */
  protected abstract getActive(): boolean;

  /** Update the body connection status. */
  protected abstract setStatus(status: Body["status"], error?: Error): void;

  /** Create and return a WebSocket instance. */
  protected abstract prepare(): Awaitable<WebSocket>;

  /** Called when the WebSocket is connected. Set up message handlers here. */
  protected abstract accept(socket: WebSocket): void;

  start(): void {
    let retryCount = 0;
    const connectionId = ++this.connectionId;
    const logger = this.ctx.logger?.("ws-client");
    const { retryTimes, retryInterval, retryLazy } = this.config;

    const reconnect = (initial: boolean, message: string) => {
      if (!this.getActive() || connectionId !== this.connectionId) return;

      let timeout = retryInterval;
      if (retryCount >= retryTimes) {
        if (initial) {
          this.setStatus("offline", new Error(message));
          return;
        }
        timeout = retryLazy;
      }

      retryCount++;
      this.setStatus("connecting");
      logger?.warn?.(`${message}, will retry in ${timeout}ms...`);
      setTimeout(() => {
        if (!this.getActive() || connectionId !== this.connectionId) return;
        connect();
      }, timeout);
    };

    const connect = async (initial = false) => {
      logger?.debug?.("websocket client opening");
      let socket: WebSocket;
      try {
        socket = await this.prepare();
      } catch (error) {
        reconnect(initial, String(error));
        return;
      }

      // remove query args to protect privacy
      const url = socket.url?.replace(/\?.+/, "");

      socket.addEventListener("error", (event) => {
        if (event.message) logger?.warn?.(event.message);
      });

      socket.addEventListener("close", ({ code, reason }) => {
        if (this.socket === socket) this.socket = undefined;
        logger?.debug?.(`websocket closed with ${code}`);
        reconnect(initial, reason || `failed to connect to ${url}, code: ${code}`);
      });

      socket.addEventListener("open", () => {
        retryCount = 0;
        this.socket = socket;
        this.setStatus("online");
        logger?.info?.(`connect to server: ${url}`);
        this.accept(socket);
      });
    };

    connect(true);
  }

  async stop(): Promise<void> {
    this.connectionId++;
    this.socket?.close();
    this.socket = undefined;
  }
}
