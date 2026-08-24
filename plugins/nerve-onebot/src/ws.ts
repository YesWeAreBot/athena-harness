export interface OneBotSocket {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  addEventListener(type: "close", listener: (event: CloseEvent) => void): void;
  send(data: string): void;
  close(): void;
}
