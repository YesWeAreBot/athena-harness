import type { Awaitable, Session } from "@yesimbot/harness-core";

import type { PerceptEvent } from "../body/types.js";
import type { ModeHandle } from "../mode/types.js";

export interface Life {
  readonly id: string;
  readonly session: Session;
  readonly activeModeId?: string;
  readonly bodyIds: readonly string[];
}

export interface LifeHandle {
  readonly life: Life;
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

export interface LifeFactory {
  create(input: CreateLifeInput): Awaitable<LifeHandle>;
  resume(input: ResumeLifeInput): Awaitable<LifeHandle>;
}
