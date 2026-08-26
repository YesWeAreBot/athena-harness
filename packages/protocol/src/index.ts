import { CortexService } from "./cortex.js";
import type { LifeService } from "./life.js";

declare module "cordis" {
  interface Context {
    life: LifeService;
    cortex: CortexService;
  }
}

export * from "./cortex.js";
export * from "./hooks.js";
export * from "./nerve.js";
export * from "./life.js";
