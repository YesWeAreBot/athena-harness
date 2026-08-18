import type { AssistantModelMessage, UserContent } from "ai";

// Extend @athena/session's SessionEventMap with agent-level event types.
// This file must be imported by any consumer that uses these event types.
declare module "@athena/session" {
  interface SessionEventMap {
    /** Content claimed from next-turn slot at the start of a Turn. */
    "user/message": { content: UserContent };
    /** Content claimed from next-step slot at the start of a Step. */
    "env/observation": { content: UserContent };
  }
}

declare module "cordis" {
  interface Events {
    "agent/stream-part"(event: { agentId: string; part: unknown }): void;
    "agent/output"(event: { agentId: string; kind: "assistant-message"; message: AssistantModelMessage }): void;
  }
}

export {}; // make this a module
