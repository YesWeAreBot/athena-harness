import { open, readFile } from "node:fs/promises";
import { join } from "node:path";
import type {
  PreparedSession,
  SessionBinding,
  SessionEvent,
  SessionHeader,
  SessionPersistenceHandler,
} from "@athena/session";
import { JsonlSessionBinding } from "./binding.js";

export class JsonlHandler implements SessionPersistenceHandler {
  constructor(private readonly config: { dir: string }) {}

  private _filePath(id: string): string {
    return join(this.config.dir, `${encodeURIComponent(id)}.jsonl`);
  }

  async prepare(id: string): Promise<PreparedSession> {
    const raw = await readFile(this._filePath(id), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);

    if (lines.length === 0) {
      throw new Error(`Session file for '${id}' is empty`);
    }

    let header: SessionHeader;
    try {
      header = JSON.parse(lines[0]!) as SessionHeader;
    } catch {
      throw new Error(`Session file for '${id}': malformed JSON in header line`);
    }

    const events: SessionEvent[] = [];
    for (let i = 1; i < lines.length; i++) {
      try {
        events.push(JSON.parse(lines[i]!) as SessionEvent);
      } catch {
        throw new Error(`Session file for '${id}': malformed JSON at line ${i + 1}`);
      }
    }

    return {
      header,
      events,
      close: async () => {},  // nothing to close — file was read synchronously
    };
  }

  async create(header: SessionHeader): Promise<SessionBinding> {
    const path = this._filePath(header.id);
    // 'wx' = write + exclusive; throws EEXIST if file already exists
    const handle = await open(path, "wx");
    await handle.appendFile(JSON.stringify(header) + "\n", "utf8");
    return new JsonlSessionBinding(handle);
  }

  async open(id: string): Promise<SessionBinding> {
    const path = this._filePath(id);
    // 'a' = append mode — does not truncate existing content
    const handle = await open(path, "a");
    return new JsonlSessionBinding(handle);
  }
}
