import type { Service } from "cordis";

import type { JsonValue } from "./json.js";

/** Free-form persona traits. Values are whatever the persona document declared. */
export interface PersonaTraits {
  [key: string]: JsonValue;
}

export interface Persona {
  name: string;
  description: string;
  traits: PersonaTraits;
  /** Persona documents may carry additional declarative fields. */
  [key: string]: JsonValue;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
}

/** Anything memory can hold: whatever survives a round trip through persistence. */
export type MemoryValue = JsonValue;

export interface MemoryEntry {
  key: string;
  value: MemoryValue;
  score?: number;
}

export interface MemoryProvider {
  store(key: string, value: MemoryValue): Promise<void>;
  retrieve(key: string): Promise<MemoryValue | null>;
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
}

export interface LifeService {
  readonly persona: Persona;
  readonly memory: MemoryProvider;
  /** The Cortex currently bound to this Life, or `null` while none is bound. */
  readonly cortex: Service | null;
  bind(cortex: Service): () => void;
}
