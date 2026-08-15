import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { SessionBinding, SessionEvent } from "@athena/session";

/**
 * Write handle for a single JSONL session file.
 * append() is synchronous (buffers to memory).
 * flush() drains the buffer to disk with an fsync.
 */
export class JsonlSessionBinding implements SessionBinding {
  private _buffer: string[] = [];
  private _handle: FileHandle;

  constructor(handle: FileHandle) {
    this._handle = handle;
  }

  append(events: readonly SessionEvent[]): void {
    for (const ev of events) {
      this._buffer.push(JSON.stringify(ev) + "\n");
    }
  }

  async flush(): Promise<void> {
    if (this._buffer.length === 0) return;
    const chunk = this._buffer.join("");
    this._buffer = [];
    await this._handle.appendFile(chunk, "utf8");
    await this._handle.sync();
  }

  async close(): Promise<void> {
    await this.flush();
    await this._handle.close();
  }
}
