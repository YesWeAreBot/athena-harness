import type { ResolvedOneBotConfig } from "./config.js";
import type { OneBotConnectionStatus } from "./types.js";

export interface OneBotTransportEvents {
  onMessage(raw: string): void;
  onStatus(status: OneBotConnectionStatus, error?: unknown): void;
}

export class OneBotWebSocketClient {
  private ws?: WebSocket;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private opening = false;
  private attempt = 0;

  constructor(
    private readonly config: ResolvedOneBotConfig,
    private readonly events: OneBotTransportEvents,
  ) {}

  async connect(): Promise<void> {
    this.stopped = false;
    this.attempt = 0;
    await this.open();
  }

  disconnect(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    const ws = this.ws;
    this.ws = undefined;
    ws?.close();
    this.events.onStatus("disconnected");
  }

  private async open(): Promise<void> {
    if (this.stopped) return;
    this.opening = true;
    this.events.onStatus("connecting");
    const ws = new WebSocket(this.buildUrl());
    this.ws = ws;
    try {
      ws.addEventListener("message", (event) => {
        this.events.onMessage(decodeMessageData(event.data));
      });

      ws.addEventListener("close", () => {
        if (this.stopped || this.opening) return;
        this.events.onStatus("disconnected");
        this.scheduleReconnect();
      });

      ws.addEventListener("error", () => {
        this.events.onStatus("disconnected", new Error("OneBot WebSocket error"));
      });

      await this.waitForOpen(ws);
      this.attempt = 0;
      this.events.onStatus("connected");
    } finally {
      this.opening = false;
    }
  }

  private buildUrl(): string {
    const url = new URL(this.config.wsUrl);
    if (this.config.accessToken) {
      url.searchParams.set("access_token", this.config.accessToken);
    }
    return url.toString();
  }

  private waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        ws.removeEventListener("open", onOpen);
        ws.removeEventListener("error", onError);
        ws.removeEventListener("close", onClose);
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      };

      const onOpen = () => finish();
      const onError = () => finish(new Error(`OneBot WebSocket connection failed: ${this.config.wsUrl}`));
      const onClose = () => finish(new Error(`OneBot WebSocket closed before connecting: ${this.config.wsUrl}`));

      timer = setTimeout(() => finish(new Error(`OneBot WebSocket connect timed out: ${this.config.wsUrl}`)), this.config.request.timeoutMs);

      ws.addEventListener("open", onOpen, { once: true });
      ws.addEventListener("error", onError, { once: true });
      ws.addEventListener("close", onClose, { once: true });
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped || !this.config.reconnect.enabled) return;
    if (this.attempt >= this.config.reconnect.maxAttempts) {
      this.events.onStatus("disconnected", new Error("OneBot WebSocket max reconnect attempts exceeded"));
      return;
    }
    const delay = Math.min(this.config.reconnect.maxDelayMs, this.config.reconnect.baseDelayMs * 2 ** this.attempt);
    this.attempt++;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.open().catch(() => undefined);
    }, delay);
  }
}

function decodeMessageData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) {
    return new TextDecoder().decode(data);
  }
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}
