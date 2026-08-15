import type { LanguageModel } from "ai";

import type { Awaitable } from "../awaitable.js";
import type { Session } from "../session/index.js";
import type { AgentContext } from "./context.js";

export type AgentStatus = "idle" | "running" | "stopping" | "disposed";

export interface Agent {
  readonly id: string;
  readonly primarySession: Session;
  readonly sessions: readonly Session[];
  getSession(id: string): Session | undefined;
  readonly model: LanguageModel;
  readonly maxSteps: number;
  readonly status: AgentStatus;
  send(type: string, data: unknown): void;
  cancel(cause?: unknown): void;
  whenIdle(): Promise<void>;
}

export interface AgentHandle {
  readonly agent: Agent;
  dispose(): Promise<void>;
}

export interface CreateAgentInput {
  id?: string;
  model: LanguageModel;
  maxSteps: number;
  setup?(ctx: AgentContext): Awaitable<void>;
}

export interface ResumeAgentInput {
  id: string;
  model: LanguageModel;
  maxSteps: number;
  setup?(ctx: AgentContext): Awaitable<void>;
}

export interface AgentFactory {
  create(input: CreateAgentInput): Awaitable<AgentHandle>;
  resume(input: ResumeAgentInput): Awaitable<AgentHandle>;
}
