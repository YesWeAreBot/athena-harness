import type { LanguageModel, UserContent } from "ai";
import type { Session } from "@athena/session";

export type AgentStatus = "idle" | "running" | "stopping" | "disposed";

export interface Agent {
  readonly id:       string;
  readonly session:  Session;
  readonly model:    LanguageModel;
  readonly maxSteps: number;
  readonly status:   AgentStatus;
  /** agentKey is the symbol used to scope tools/prompt registrations to this agent. */
  readonly agentKey: symbol;

  /** Append to next-turn slot and wake the loop. Triggers a full new Turn. */
  followup(content: UserContent): void;

  /** Append to next-step slot and wake the loop. Claimed at next Step start. */
  steer(content: UserContent): void;

  /** Append to next-step slot without waking. Passive env accumulation. */
  inject(content: UserContent): void;

  cancel(cause?: unknown): void;
  whenIdle(): Promise<void>;
}

export interface AgentHandle {
  readonly agent: Agent;
  dispose(): Promise<void>;
}

export interface CreateAgentOptions {
  id?:       string;
  model:     LanguageModel;
  maxSteps?: number;
  /** Called before the agent is published. Register scoped tools/prompt here. */
  setup?(agentCtx: import("cordis").Context): void | Promise<void>;
}

export interface ResumeAgentOptions {
  id:        string;
  model:     LanguageModel;
  maxSteps?: number;
  setup?(agentCtx: import("cordis").Context): void | Promise<void>;
}

export interface AgentFactory {
  createAgent(options: CreateAgentOptions): Promise<AgentHandle>;
  resumeAgent(options: ResumeAgentOptions): Promise<AgentHandle>;
}
