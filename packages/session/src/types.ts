import type {
  AssistantModelMessage,
  ModelMessage,
  ToolCallPart,
  ToolResultPart,
  UserContent,
} from "ai";

// ── Event map ─────────────────────────────────────────────────────────────────
// Other packages extend this via `declare module '@athena/session'`.
export interface SessionEventMap {
  "turn/start":        { turn: number };
  "turn/end":          { turn: number; reason: TurnEndReason };
  "step/start":        { turn: number; step: number };
  "step/end":          { turn: number; step: number };
  "assistant/message": { turn: number; step: number; message: AssistantModelMessage };
  "tool/call":         { turn: number; step: number; call: ToolCallPart };
  "tool/result":       { turn: number; step: number; result: ToolResultPart; status: ToolResultStatus };
  "request/header":    { turn: number; step: number; header: RequestHeader };
  "context/snapshot":  { turn: number; step: number; rendered: string };
}

export interface RequestHeader {
  modelId?: string;
  provider?: string;
  tools?: string[];
}

export type TurnEndReason =
  | { kind: "completed" }
  | { kind: "aborted";   cause?: unknown }
  | { kind: "error";     error: unknown }
  | { kind: "max-tokens" }
  | { kind: "max-steps"; limit: number }
  | { kind: "interrupted" };

export type ToolResultStatus = "ok" | "error" | "interrupted";

// ── Event ─────────────────────────────────────────────────────────────────────
export type SurfaceOp = "append" | { replace: { start: number; end: number } };

export interface AppendOptions {
  surfaceOp?:       SurfaceOp;
  sourceEventSeqs?: readonly number[];
}

export interface SessionEvent<T = unknown> {
  readonly type:             string;
  readonly seq:              number;
  readonly time:             number;
  readonly data:             T;
  readonly surfaceOp?:       SurfaceOp;
  readonly sourceEventSeqs?: readonly number[];
}

// ── Session header + snapshot ─────────────────────────────────────────────────
export interface SessionHeader {
  readonly id:        string;
  readonly createdAt: number;
}

export interface SessionSnapshot {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
}

// ── Surface ───────────────────────────────────────────────────────────────────
export interface SurfaceNode {
  readonly seq: number;
}

export type Projector<T = unknown> = (event: SessionEvent<T>) => ModelMessage | null;

export interface ProjectorMap {
  global: Map<string, Projector>;
  scoped: Map<symbol, Map<string, Projector>>;
}
