import type { Awaitable, Session } from "@yesimbot/harness-core";

import type { PerceptEvent } from "../body/types.js";

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

export type ModeSchedulingKind = "none" | "event" | "timer" | "tingle" | "due-intent" | "sweep" | "auto-advance" | "custom";

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

export interface ModeContext {
  readonly lifeId?: string;
  readonly session?: Session;
  readonly bodies?: ModeBodyAccess;
}

export interface Mode<C = any> {
  readonly name: string;
  readonly description?: string;
  readonly capabilities?: ModeCapabilities;
  setup(ctx: ModeContext, config: C): Awaitable<ModeSetupHandle>;
}

export interface ModeHandle {
  readonly id: string;
  readonly name: string;
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
