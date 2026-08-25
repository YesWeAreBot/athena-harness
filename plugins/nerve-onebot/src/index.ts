import type * as OneBot from "./types.js";

export { OneBotBody, OneBotBody as default } from "./bot/index.js";
export { OneBotMessageEncoder } from "./bot/message.js";
export { OneBotWsClient, OneBotWsServer } from "./ws.js";
export { OneBotHttpServer } from "./http.js";
export { CQCode } from "./bot/cqcode.js";
export * as OneBot from "./types.js";
export { adaptChannel, adaptGuild, adaptMessage, decodeGuildMember, decodeUser, dispatchEvent, PRIVATE_PFX } from "./utils.js";

// OneBot-specific internal events are emitted dynamically under their `_type`
// (satori pattern, see NerveService.dispatch); declare them here so listener
// signatures are checked. The payload is the raw OneBot payload plus the
// originating Body (nerve.ts emits `(data, body)`).
declare module "cordis" {
  interface Events {
    "onebot/poke"(data: OneBot.Payload, body: import("@athena-ai/protocol").Body): void;
    "onebot/message-reactions-updated"(data: OneBot.Payload, body: import("@athena-ai/protocol").Body): void;
  }
}

// Raw OneBot payload is attached to every session under `session.onebot`
// (dispatchEvent sets it via setInternal on non-internal events).
declare module "@athena-ai/protocol" {
  interface Event {
    onebot?: OneBot.Payload;
  }
}
