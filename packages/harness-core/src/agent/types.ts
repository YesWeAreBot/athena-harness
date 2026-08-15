import type { LanguageModel } from "ai";
import type { Context } from "cordis";

import type { Awaitable } from "../awaitable.js";
import type { Session } from "../session/index.js";

export type AgentStatus = "idle" | "running" | "stopping" | "disposed";

export interface Agent {
  readonly id: string;
  readonly session: Session;
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
  setup?(ctx: Context): Awaitable<void>;
}

export interface ResumeAgentInput {
  id: string;
  model: LanguageModel;
  maxSteps: number;
  setup?(ctx: Context): Awaitable<void>;
}

export interface AgentFactory {
  create(input: CreateAgentInput): Awaitable<AgentHandle>;
  resume(input: ResumeAgentInput): Awaitable<AgentHandle>;
}
