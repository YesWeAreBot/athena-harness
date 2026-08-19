import type { Life } from "./life";

export { Life } from "./life";
export { Cortex } from "./cortex";
export { Life as default } from "./life";
export type { Persona, MemoryProvider, MemoryEntry, SearchOptions, LifeService } from "./types";

declare module "cordis" {
  interface Context {
    life: Life;
  }
}
