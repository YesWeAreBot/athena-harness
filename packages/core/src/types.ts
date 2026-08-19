import type { Service } from "cordis";

export interface Persona {
  name: string;
  description: string;
  traits: Record<string, any>;
  [key: string]: any;
}

export interface SearchOptions {
  limit?: number;
  threshold?: number;
}

export interface MemoryEntry {
  key: string;
  value: any;
  score?: number;
}

export interface MemoryProvider {
  store(key: string, value: any): Promise<void>;
  retrieve(key: string): Promise<any>;
  search(query: string, options?: SearchOptions): Promise<MemoryEntry[]>;
}

export interface LifeService {
  readonly persona: Persona;
  readonly memory: MemoryProvider;
  registerCortex(cortex: Service): void;
  unregisterCortex(cortex: Service): void;
}
