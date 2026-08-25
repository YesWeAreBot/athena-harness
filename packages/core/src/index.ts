import { NerveService } from "@athena-ai/protocol";
import { Context } from "cordis";

export function apply(ctx: Context) {
  ctx.plugin(NerveService);
}

export * from "cordis";
export * from "cosmokit";
export { default as Schema } from "schemastery";

// Re-export protocol (Nerve core types)
export { Body, Cortex, NerveService } from "@athena-ai/protocol";
export type { JsonObject, JsonValue } from "@athena-ai/protocol";
export type { Event, LifeService, MemoryEntry, MemoryProvider, MemoryValue, Persona, PersonaTraits, SearchOptions, Status } from "@athena-ai/protocol";
export type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle, SandboxRequestPayload } from "@athena-ai/protocol";
