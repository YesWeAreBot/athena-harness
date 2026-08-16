import type { Agent } from "@athena/agent";
import type { Session } from "@athena/session";

import type { AgentLoopAccess } from "../agent-loop/types.js";
import type { PerceptEvent } from "../body/types.js";
import type { Awaitable } from "../internal.js";
import type { Life } from "../life/types.js";
import type { LifeMemory } from "../memory/index.js";
import type { ModeSchedulerAccess, SchedulingKind } from "../scheduler/types.js";

export type ModeDriverKind = "finite-tool-loop" | "continuous-mailbox" | "narrative-decision" | "custom";

export interface ModePerceptInterest {
  readonly body?: string;
  readonly kind?: string;
}

export interface ModeActuatorInterest {
  readonly body?: string;
  readonly actuator?: string;
  readonly kind?: string;
}

export type ModeSchedulingKind = SchedulingKind;

export type ModeMemoryKind = "none" | "conversation" | "life-stream" | "world-status" | "facts" | "story-facts" | "embedding" | "custom";

export type ModeProductStateKind = "none" | "channel" | "world" | "story" | "custom";

export interface ModeCapabilities {
  readonly driver: ModeDriverKind;
  readonly percepts: readonly ModePerceptInterest[];
  readonly actuators: readonly ModeActuatorInterest[];
  readonly scheduling: readonly ModeSchedulingKind[];
  readonly memory: readonly ModeMemoryKind[];
  readonly productState: readonly ModeProductStateKind[];
  readonly bodies?: readonly string[];
}

export interface ModeBodyAccess {
  dispatch<T>(bodyId: string, kind: string, data: T): PerceptEvent<T>;
  act(bodyId: string, actuatorId: string, action: unknown): Promise<unknown>;
}

/**
 * @experimental Mode infrastructure contract. Shape may change until contract freeze.
 */
export interface ModeContext {
  readonly lifeId?: string;
  readonly life?: Life;
  readonly session?: Session;
  readonly agent?: Agent;
  readonly bodies?: ModeBodyAccess;
  readonly memory?: LifeMemory;
  readonly scheduler?: ModeSchedulerAccess;
  readonly agentLoop?: AgentLoopAccess;
}

export interface Mode<C = any> {
  readonly name: string;
  readonly description?: string;
  readonly capabilities?: ModeCapabilities;
  setup(ctx: ModeContext, config: C): Awaitable<ModeSetupHandle>;
}

/**
 * @experimental Runtime Mode handle owned by ModeRegistry and LifeRegistry.
 */
export interface ModeHandle {
  readonly id: string;
  readonly name: string;
  readonly capabilities?: ModeCapabilities;
  readonly disposed: boolean;
  start?(): Awaitable<void>;
  stop?(): Awaitable<void>;
  handle?(event: PerceptEvent): Awaitable<boolean>;
  dispose?(): Awaitable<void>;
}

export interface ModeSetupHandle {
  start?(): Awaitable<void>;
  stop?(): Awaitable<void>;
  handle?(event: PerceptEvent): Awaitable<boolean>;
  dispose?(): Awaitable<void>;
}
