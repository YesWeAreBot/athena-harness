export * from "@athena-ai/protocol";

export * from "./body.js";
export * as h from "./element.js";
export type { Element, Fragment } from "./element.js";
export * from "./encoder.js";
export * from "./events.js";
export * from "./session.js";
export * from "./types.js";
export * from "./ws.js";
export type { WebSocket, WsClientConfig } from "./ws.js";

// Explicitly re-export Event to resolve the ambiguity introduced by
// `export * from "@athena-ai/protocol"` (which already exports Event).
export type { Event } from "@athena-ai/protocol";
