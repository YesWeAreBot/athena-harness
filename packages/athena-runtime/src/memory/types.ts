import type { Awaitable } from "../internal.js";

/**
 * Memory is early-stage infrastructure.
 * The current contract is intentionally minimal: it proves Life-scoped recall,
 * but ingestion, derived memory, compaction, forgetting policy, and stability
 * are not finalized. Do not treat this API as stable.
 */
export type MemoryScope = "identity" | "biography" | "preference" | "relationship" | "derived";

export interface MemoryRecord {
  readonly id: string;
  readonly lifeId: string;
  readonly scope: MemoryScope;
  readonly category: string;
  readonly content: string;
  readonly importance: number;
  readonly confidence: number;
  readonly sourcePerceptId?: string;
  readonly createdAt: number;
}

export interface MemoryRecallOptions {
  readonly scope?: MemoryScope;
  readonly category?: string;
  readonly query?: string;
  readonly limit?: number;
}

export interface MemoryInput {
  readonly lifeId: string;
  readonly scope: MemoryScope;
  readonly category: string;
  readonly content: string;
  readonly importance?: number;
  readonly confidence?: number;
  readonly sourcePerceptId?: string;
}

export interface LifeMemory {
  remember(input: MemoryInput): Awaitable<MemoryRecord>;
  recall(lifeId: string, options?: MemoryRecallOptions): Awaitable<readonly MemoryRecord[]>;
  forget(id: string): Awaitable<boolean>;
  clear(lifeId: string): Awaitable<void>;
}
