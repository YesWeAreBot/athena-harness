import type { SandboxHubService } from "./sandbox.js";
import type { LifeService } from "./types.js";

declare module "cordis" {
  interface Context {
    life: LifeService;
    sandbox: SandboxHubService;
  }
}

export { Cortex } from "./cortex.js";
export type { JsonObject, JsonValue } from "./json.js";
export type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle, SandboxRequestPayload } from "./sandbox.js";
export { Body, NerveService } from "./nerve.js";
export type { NerveEvent, NerveEventMap, Status } from "./nerve.js";
export type { LifeService, MemoryEntry, MemoryProvider, MemoryValue, Persona, PersonaTraits, SearchOptions } from "./types.js";
