import type { UserContent } from "ai";

// Extend @athena/session's SessionEventMap with agent-level event types.
// This file must be imported by any consumer that uses these event types.
declare module "@athena/session" {
  interface SessionEventMap {
    /** Content claimed from next-turn slot at the start of a Turn. */
    "user/message":    { content: UserContent };
    /** Content claimed from next-step slot at the start of a Step. */
    "env/observation": { content: UserContent };
  }
}

export {};  // make this a module
