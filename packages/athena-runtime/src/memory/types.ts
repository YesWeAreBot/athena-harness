import type { Awaitable } from "../internal.js";

/**
 * Memory is early-stage infrastructure.
 * The current contract is intentionally minimal: it proves Life-scoped recall,
 * but ingestion, derived memory, compaction, forgetting policy, and stability
 * are not finalized. Do not treat this API as stable.
 */
export type MemoryScope = "identity" | "biography" | "preference" | "relationship" | "derived" | (string & {});

export interface MemoryRecord {
  readonly id: string;
  readonly lifeId: string;
  readonly scope: MemoryScope;
  readonly category: string;
  readonly content: string;
  readonly importance: number;
  readonly confidence: number;
  readonly sourcePerceptId?: string;
  readonly sourceBodyId?: string;
  readonly sourceBodyKind?: string;
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
  readonly sourceBodyId?: string;
  readonly sourceBodyKind?: string;
}

export interface MemoryPercept {
  readonly id: string;
  readonly bodyId: string;
  readonly kind: string;
}

/**
 * Memory stores only the derived content supplied by the caller.
 * Full Body.state remains on the Body and is not copied into Memory.
 */
export interface PerceptMemoryInput {
  readonly lifeId: string;
  readonly percept: MemoryPercept;
  readonly scope: MemoryScope;
  readonly category: string;
  readonly content: string;
  readonly importance?: number;
  readonly confidence?: number;
}

export interface MemoryProvider {
  readonly id: string;
  readonly scopes: readonly MemoryScope[];
  remember(input: MemoryInput): Awaitable<MemoryRecord>;
  recall(lifeId: string, options?: MemoryRecallOptions): Awaitable<readonly MemoryRecord[]>;
  forget(id: string): Awaitable<boolean>;
  clear(lifeId: string): Awaitable<void>;
}

export interface LifeMemory {
  remember(input: MemoryInput): Awaitable<MemoryRecord>;
  ingestPercept(input: PerceptMemoryInput): Awaitable<MemoryRecord>;
  recall(lifeId: string, options?: MemoryRecallOptions): Awaitable<readonly MemoryRecord[]>;
  forget(id: string): Awaitable<boolean>;
  clear(lifeId: string): Awaitable<void>;
  registerProvider(provider: MemoryProvider): () => void;
  unregisterProvider(id: string): boolean;
  listProviders(): readonly MemoryProvider[];
}
