import type { Agent, CreateAgentOptions } from "@athena/agent";
import type { Session } from "@athena/session";

import type { Awaitable } from "../internal.js";
import type { PerceptEvent } from "../body/types.js";
import type { ModeHandle } from "../mode/types.js";

export interface Life {
  readonly id: string;
  readonly session: Session;
  readonly agent?: Agent;
  readonly activeModeId?: string;
  readonly bodyIds: readonly string[];
}

export interface LifeHandle {
  readonly life: Life;
  readonly agent?: Agent;
  readonly activeModeId?: string;
  setMode(mode: ModeHandle | undefined): Awaitable<void>;
  createMode<C = any>(name: string, config: C): Promise<ModeHandle>;
  dispatchPercept(event: PerceptEvent): Awaitable<boolean>;
  attachBody(bodyId: string): Awaitable<void>;
  detachBody(bodyId: string): Awaitable<void>;
  hasBody(bodyId: string): boolean;
  dispose(): Promise<void>;
}

export interface CreateLifeInput {
  id?: string;
}

export interface ResumeLifeInput {
  id: string;
}

export interface LifeAgentLoopOptions {
  readonly model: CreateAgentOptions["model"];
  readonly maxSteps?: CreateAgentOptions["maxSteps"];
  readonly setup?: CreateAgentOptions["setup"];
}

export interface CreateLifeAgentInput extends CreateLifeInput {
  readonly agentLoop: LifeAgentLoopOptions;
}

export interface ResumeLifeAgentInput extends ResumeLifeInput {
  readonly agentLoop: LifeAgentLoopOptions;
}

export interface LifeFactory {
  create(input: CreateLifeInput): Awaitable<LifeHandle>;
  resume(input: ResumeLifeInput): Awaitable<LifeHandle>;
}
