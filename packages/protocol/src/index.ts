export { Cortex } from "./cortex";
export type { Persona, MemoryProvider, MemoryEntry, SearchOptions, LifeService } from "./types";
export type { MessageSink, SandboxDispatchPayload, SandboxNerveHandle, SandboxHubService } from "./sandbox";

import type { SandboxHubService } from "./sandbox";
import type { LifeService } from "./types";

declare module "cordis" {
  interface Context {
    life: LifeService;
    sandbox: SandboxHubService;
  }
}
