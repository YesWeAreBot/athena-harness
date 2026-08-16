import { Service } from "cordis";
import type { Context } from "cordis";

import { createMemoryRecord } from "./record.js";
import type {
  LifeMemory as LifeMemoryContract,
  MemoryInput,
  MemoryProvider,
  MemoryRecallOptions,
  MemoryRecord,
  MemoryScope,
  PerceptMemoryInput,
} from "./types.js";

/**
 * Early Memory provider boundary.
 * InMemoryMemory exists for tests and composition validation; production memory
 * will need ingestion, derived state, compaction, and a stable persistence
 * contract. The current API may change.
 */
export abstract class LifeMemory extends Service implements LifeMemoryContract {
  static provide = "memory";

  private readonly providers = new Map<string, MemoryProvider>();

  constructor(ctx: Context) {
    super(ctx, "memory");
    this.ctx.effect(() => () => {
      this.providers.clear();
    });
  }

  registerProvider(provider: MemoryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Memory provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this.ctx.effect(() => () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    });
  }

  unregisterProvider(id: string): boolean {
    return this.providers.delete(id);
  }

  listProviders(): readonly MemoryProvider[] {
    return [...this.providers.values()];
  }

  async remember(input: MemoryInput): Promise<MemoryRecord> {
    const provider = this.providerFor(input.scope);
    return provider ? await provider.remember(input) : await this.rememberLocal(input);
  }

  async ingestPercept(input: PerceptMemoryInput): Promise<MemoryRecord> {
    return this.remember({
      lifeId: input.lifeId,
      scope: input.scope,
      category: input.category,
      content: input.content,
      importance: input.importance,
      confidence: input.confidence,
      sourcePerceptId: input.percept.id,
      sourceBodyId: input.percept.bodyId,
      sourceBodyKind: input.percept.kind,
    });
  }

  async recall(lifeId: string, options: MemoryRecallOptions = {}): Promise<readonly MemoryRecord[]> {
    if (options.scope) {
      const provider = this.providerFor(options.scope);
      return provider ? await provider.recall(lifeId, options) : await this.recallLocal(lifeId, options);
    }
    const local = await this.recallLocal(lifeId, options);
    const providerResults = await Promise.all([...this.providers.values()].map((provider) => provider.recall(lifeId, options)));
    return [...local, ...providerResults.flat()].sort((left, right) => right.importance - left.importance || right.createdAt - left.createdAt);
  }

  async forget(id: string): Promise<boolean> {
    let removed = await this.forgetLocal(id);
    for (const provider of this.providers.values()) {
      if (await provider.forget(id)) removed = true;
    }
    return removed;
  }

  async clear(lifeId: string): Promise<void> {
    await this.clearLocal(lifeId);
    await Promise.all([...this.providers.values()].map((provider) => provider.clear(lifeId)));
  }

  private providerFor(scope: MemoryScope): MemoryProvider | undefined {
    for (const provider of this.providers.values()) {
      if (provider.scopes.includes(scope)) return provider;
    }
    return undefined;
  }

  abstract rememberLocal(input: MemoryInput): Promise<MemoryRecord>;

  abstract recallLocal(lifeId: string, options?: MemoryRecallOptions): Promise<readonly MemoryRecord[]>;

  abstract forgetLocal(id: string): Promise<boolean>;

  abstract clearLocal(lifeId: string): Promise<void>;
}

export class InMemoryMemory extends LifeMemory {
  private readonly records = new Map<string, MemoryRecord>();

  constructor(ctx: Context) {
    super(ctx);
  }

  async rememberLocal(input: MemoryInput): Promise<MemoryRecord> {
    const record = createMemoryRecord(input);
    this.records.set(record.id, record);
    return record;
  }

  async recallLocal(lifeId: string, options: MemoryRecallOptions = {}): Promise<readonly MemoryRecord[]> {
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

  async forgetLocal(id: string): Promise<boolean> {
    return this.records.delete(id);
  }

  async clearLocal(lifeId: string): Promise<void> {
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

export type { MemoryInput, MemoryPercept, MemoryProvider, MemoryRecallOptions, MemoryRecord, MemoryScope, PerceptMemoryInput } from "./types.js";
