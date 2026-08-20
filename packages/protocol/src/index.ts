import type { SandboxHubService } from "./sandbox.js";
import type { LifeService } from "./types.js";

declare module "cordis" {
  interface Context {
    life: LifeService;
    sandbox: SandboxHubService;
  }
}

export { Cortex } from "./cortex.js";
export type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "./sandbox.js";
export type { LifeService, MemoryEntry, MemoryProvider, Persona, SearchOptions } from "./types.js";
