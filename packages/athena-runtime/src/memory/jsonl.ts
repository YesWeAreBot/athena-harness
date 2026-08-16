import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "cordis";

import { LifeMemory } from "./index.js";
import { createMemoryRecord } from "./record.js";
import type { MemoryInput, MemoryRecallOptions, MemoryRecord } from "./types.js";

/**
 * Early JSONL Memory provider.
 * It is append/rewrite based and intentionally simple; atomicity, batching,
 * migration, and derived memory are not implemented yet.
 */
export interface JsonlMemoryConfig {
  readonly root: string;
}

export class JsonlMemory extends LifeMemory {
  private readonly tail = new Map<string, Promise<void>>();

  constructor(
    ctx: Context,
    private readonly config: JsonlMemoryConfig,
  ) {
    super(ctx);
  }

  async rememberLocal(input: MemoryInput): Promise<MemoryRecord> {
    const record = createMemoryRecord(input);
    await this.append(input.lifeId, record);
    return record;
  }

  async recallLocal(lifeId: string, options: MemoryRecallOptions = {}): Promise<readonly MemoryRecord[]> {
    await this.tail.get(lifeId);
    const query = options.query?.trim().toLowerCase();
    const records = await this.read(lifeId);
    return Object.freeze(
      records
        .filter((record) => options.scope === undefined || record.scope === options.scope)
        .filter((record) => options.category === undefined || record.category === options.category)
        .filter((record) => query === undefined || record.content.toLowerCase().includes(query))
        .sort((left, right) => right.importance - left.importance || right.createdAt - left.createdAt)
        .slice(0, options.limit ?? 50),
    );
  }

  async forgetLocal(id: string): Promise<boolean> {
    for (const lifeId of await this.lifeIds()) {
      const records = await this.read(lifeId);
      const next = records.filter((record) => record.id !== id);
      if (next.length === records.length) continue;
      await this.write(lifeId, next);
      return true;
    }
    return false;
  }

  async clearLocal(lifeId: string): Promise<void> {
    await rm(this.path(lifeId), { force: true });
  }

  private async append(lifeId: string, record: MemoryRecord): Promise<void> {
    await mkdir(this.config.root, { recursive: true });
    const previous = this.tail.get(lifeId) ?? Promise.resolve();
    const next = previous.then(() => appendFile(this.path(lifeId), `${JSON.stringify(record)}\n`, "utf8"));
    this.tail.set(
      lifeId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    await next;
  }

  private async read(lifeId: string): Promise<MemoryRecord[]> {
    const content = await readFile(this.path(lifeId), "utf8").catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return "";
      throw cause;
    });
    const records: MemoryRecord[] = [];
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        records.push(JSON.parse(line) as MemoryRecord);
      } catch {
        // skip malformed lines without failing recall
      }
    }
    return records;
  }

  private async write(lifeId: string, records: readonly MemoryRecord[]): Promise<void> {
    await mkdir(this.config.root, { recursive: true });
    const target = this.path(lifeId);
    const temporary = `${target}.${Date.now()}.tmp`;
    await writeFile(temporary, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`, "utf8");
    await rename(temporary, target);
  }

  private async lifeIds(): Promise<string[]> {
    try {
      const entries = await readdir(this.config.root, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")).map((entry) => entry.name.slice(0, -6));
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  private path(lifeId: string): string {
    return join(this.config.root, `${encodeURIComponent(lifeId)}.jsonl`);
  }
}

export const jsonlMemory = {
  apply(ctx: Context, config: JsonlMemoryConfig) {
    new JsonlMemory(ctx, config);
  },
};
