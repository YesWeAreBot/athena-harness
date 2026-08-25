import type { SandboxHubService } from "./sandbox.js";
import type { LifeService } from "./types.js";

declare module "cordis" {
  interface Context {
    life: LifeService;
    sandbox: SandboxHubService;
  }
}

export * from "./cortex.js";
export * from "./nerve.js";
export * from "./sandbox.js";
export * from "./types.js";
