import type { Service } from "cordis";

export interface LifeService {
  /** Stable identifier for this Life (e.g. lowercased persona name or config id). */
  readonly id: string | undefined;
  readonly cortex: Service | null;
  bind(cortex: Service): () => void;
}
