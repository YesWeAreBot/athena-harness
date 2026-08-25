// Re-export Nerve core types for convenience
export { Body, NerveService } from "@athena-ai/protocol";
export { Session } from "@athena-ai/protocol";
export type { Event, Status } from "@athena-ai/protocol";
// IM Session envelope
export { IMSession } from "./session.js";
export type { IMSession as IMSessionType } from "./session.js";

// IM entity types
export type { BidiList, Direction, Friend, Guild, GuildMember, GuildRole, List, Login, Message, Order, SendOptions, User } from "./types.js";
// Channel and LoginStatus are both types and const enum values
export { Channel, LoginStatus } from "./types.js";

// IM Methods table (data-driven registry)
export { Field, Method, Methods } from "./methods.js";
export type { Field as FieldType, Method as MethodType } from "./methods.js";

// IM Body base class with default implementations
export { IMBody } from "./body.js";

// IM events — side-effect import registers Event extension and cordis.Events
import "./events.js";
export type {
  IMEvent,
  IMFriendEvent,
  IMGuildEvent,
  IMGuildMemberEvent,
  IMGuildRoleEvent,
  IMInternalEvent,
  IMLoginEvent,
  IMMessageDeletedEvent,
  IMMessageEvent,
  IMMessageUpdatedEvent,
  IMReactionEvent,
  IMRequestEvent,
  IMSendEvent,
} from "./events.js";

// MessageEncoder base
export { MessageEncoder } from "./encoder.js";

// WsClient base
export { DefaultWsClientConfig, WsClient } from "./ws.js";
export type { WebSocket, WsClientConfig } from "./ws.js";

// Element utilities
export * as h from "./element.js";
export { at, atAll, audio, file, image, quote, sharp, video } from "./element.js";
export type { Element, Fragment } from "./element.js";
export { normalize, parse } from "./element.js";
