import type { AssistantModelMessage, ToolCallPart, ToolModelMessage, UserContent } from "ai";

export interface SessionEventMap {
  "turn/start": {
    turn: number;
  };
  "turn/end": {
    turn: number;
    reason: TurnEndReason;
  };
  "step/start": {
    turn: number;
    step: number;
  };
  "step/end": {
    turn: number;
    step: number;
  };
  "user/message": {
    content: UserContent;
  };
  "assistant/message": {
    turn: number;
    step: number;
    message: AssistantModelMessage;
  };
  "tool/call": {
    turn: number;
    step: number;
    call: ToolCallPart;
  };
  "tool/result": {
    turn: number;
    step: number;
    message: ToolModelMessage;
  };
  "request/header": {
    turn: number;
    step: number;
    header: unknown;
  };
}

export interface TurnEndReasonMap {
  completed: {
    kind: "completed";
  };
  aborted: {
    kind: "aborted";
    cause?: unknown;
  };
  error: {
    kind: "error";
    error: unknown;
  };
  "max-tokens": {
    kind: "max-tokens";
  };
  "max-steps": {
    kind: "max-steps";
    limit: number;
  };
  interrupted: {
    kind: "interrupted";
  };
}

export type TurnEndReason = TurnEndReasonMap[keyof TurnEndReasonMap];

export const MODEL_VISIBLE_EVENT_TYPES: ReadonlySet<string> = new Set(["user/message", "assistant/message", "tool/result"]);

export const NON_SURFACE_EVENT_TYPES: ReadonlySet<string> = new Set(["turn/start", "turn/end", "step/start", "step/end", "tool/call", "request/header"]);
