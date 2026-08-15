import { createId } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { LifeMemory as LifeMemoryContract, MemoryInput, MemoryRecallOptions, MemoryRecord } from "./types.js";

/**
 * Early Memory provider boundary.
 * InMemoryMemory exists for tests and composition validation; production memory
 * will need ingestion, derived state, compaction, and a stable persistence
 * contract. The current API may change.
 */
export abstract class LifeMemory extends Service implements LifeMemoryContract {
  static provide = "memory";

  constructor(ctx: Context) {
    super(ctx, "memory");
  }

  abstract remember(input: MemoryInput): Promise<MemoryRecord>;

  abstract recall(lifeId: string, options?: MemoryRecallOptions): Promise<readonly MemoryRecord[]>;

  abstract forget(id: string): Promise<boolean>;

  abstract clear(lifeId: string): Promise<void>;
}

export class InMemoryMemory extends LifeMemory {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(ctx: Context) {
    super(ctx);
  }

  async remember(input: MemoryInput): Promise<MemoryRecord> {
    const record: MemoryRecord = {
      id: createId("memory"),
      lifeId: input.lifeId,
      scope: input.scope,
      category: input.category,
      content: input.content,
      importance: input.importance ?? 0.5,
      confidence: input.confidence ?? 0.5,
      ...(input.sourcePerceptId === undefined ? {} : { sourcePerceptId: input.sourcePerceptId }),
      createdAt: Date.now(),
    };
    this.records.set(record.id, record);
    return record;
  }

  async recall(lifeId: string, options: MemoryRecallOptions = {}): Promise<readonly MemoryRecord[]> {
    const query = options.query?.trim().toLowerCase();
    return Object.freeze(
      [...this.records.values()]
        .filter((record) => record.lifeId === lifeId)
        .filter((record) => options.scope === undefined || record.scope === options.scope)
        .filter((record) => options.category === undefined || record.category === options.category)
        .filter((record) => query === undefined || record.content.toLowerCase().includes(query))
        .sort((left, right) => right.importance - left.importance || right.createdAt - left.createdAt)
        .slice(0, options.limit ?? 50)
        .map((record) => ({ ...record })),
    );
  }

  async forget(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async clear(lifeId: string): Promise<void> {
    for (const [id, record] of this.records) {
      if (record.lifeId === lifeId) this.records.delete(id);
    }
  }
}

export const memoryRegistry = {
  apply(ctx: Context) {
    new InMemoryMemory(ctx);
  },
};

declare module "cordis" {
  interface Context {
    memory: LifeMemory;
  }
}

export type { MemoryInput, MemoryRecallOptions, MemoryRecord } from "./types.js";
