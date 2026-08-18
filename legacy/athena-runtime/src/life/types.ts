import type { Agent, CreateAgentOptions } from "@athena/agent";
import type { Session } from "@athena/session";

import type { PerceptEvent } from "../body/types.js";
import type { Awaitable } from "../internal.js";
import type { ModeDeliveryKind, ModeDeliveryReceipt, ModeDeliverySchedule, ModeHandle, ModeModelRole } from "../mode/types.js";

export interface Life {
  readonly id: string;
  readonly session: Session;
  readonly agent?: Agent;
  readonly disposed: boolean;
  readonly activeModeId?: string;
  readonly bodyIds: readonly string[];
}

export interface LifeHandle {
  readonly life: Life;
  readonly agent?: Agent;
  readonly disposed: boolean;
  readonly activeModeId?: string;
  setMode(mode: ModeHandle | undefined): Awaitable<void>;
  createMode<C = any>(name: string, config: C): Promise<ModeHandle>;
  dispatchPercept(event: PerceptEvent): Awaitable<boolean>;
  wake(reason: string, data?: unknown): Awaitable<boolean>;
  setModel(providerId: string): Awaitable<void>;
  setModelByRole(role: ModeModelRole): Awaitable<void>;
  getState<T = unknown>(id: string): Awaitable<T | undefined>;
  setState<T = unknown>(id: string, value: T): Awaitable<void>;
  deliver(kind: ModeDeliveryKind, target: unknown, payload: unknown): Awaitable<ModeDeliveryReceipt>;
  scheduleDelivery(delivery: ModeDeliverySchedule): Awaitable<ModeDeliveryReceipt>;
  cancelDelivery(id: string): Awaitable<boolean>;
  attachBody(bodyId: string): Awaitable<void>;
  detachBody(bodyId: string): Awaitable<void>;
  hasBody(bodyId: string): boolean;
  dispose(): Promise<void>;
}

export interface PerceptPipeline {
  readonly attention?: (event: PerceptEvent) => Awaitable<boolean>;
  readonly compact?: (event: PerceptEvent) => Awaitable<PerceptEvent>;
}

export type PerceptRejectReason = "attention" | "capabilities" | "no-mode" | "hook";

export interface CreateLifeInput {
  id?: string;
  perceptPipeline?: PerceptPipeline;
}

export interface ResumeLifeInput {
  id: string;
  perceptPipeline?: PerceptPipeline;
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
