export { Cortex } from "./cortex";
export type { Persona, MemoryProvider, MemoryEntry, SearchOptions, LifeService } from "./types";

import type { LifeService } from "./types";

declare module "cordis" {
  interface Context {
    life: LifeService;
  }
}
