import type { Agent } from "@athena/agent";
import type { Session } from "@athena/session";

import type { AgentLoopAccess } from "../agent-loop/types.js";
import type { ActuatorOptions, ActuatorResult, PerceptEvent } from "../body/types.js";
import type { Awaitable } from "../internal.js";
import type { Life } from "../life/types.js";
import type { LifeMemory, MemoryProvider } from "../memory/index.js";
import type { ModeSchedulerAccess, ScheduledTaskHandle, ScheduledTaskOptions, SchedulingKind } from "../scheduler/types.js";

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

export type ModeModelRole = "main" | "compaction" | "embedding" | "gate" | "custom";

export type ModeStateKind = "none" | "life" | "story" | "world" | "participant" | "custom";

export type ModeDeliveryKind = "none" | "message" | "channel" | "cross-conversation" | "media" | "custom";

export interface ModeCapabilities {
  readonly driver: ModeDriverKind;
  readonly percepts: readonly ModePerceptInterest[];
  readonly actuators: readonly ModeActuatorInterest[];
  readonly scheduling: readonly ModeSchedulingKind[];
  readonly memory: readonly ModeMemoryKind[];
  readonly productState: readonly ModeProductStateKind[];
  readonly models?: readonly ModeModelRole[];
  readonly state?: readonly ModeStateKind[];
  readonly delivery?: readonly ModeDeliveryKind[];
  readonly bodies?: readonly string[];
}

export interface ModeModelProvider {
  readonly id: string;
  readonly roles: readonly ModeModelRole[];
  get(): Awaitable<unknown>;
}

export interface ModeStateProvider {
  readonly id: string;
  readonly kinds: readonly ModeStateKind[];
  get(): Awaitable<unknown>;
  set?(next: unknown): Awaitable<void>;
}

export interface ModeDeliveryProvider {
  readonly id: string;
  readonly kinds: readonly ModeDeliveryKind[];
  deliver?(target: unknown, payload: unknown): Awaitable<unknown>;
}

export interface ModeSchedulerProvider {
  readonly id: string;
  readonly kinds: readonly ModeSchedulingKind[];
  schedule(options: ScheduledTaskOptions): ScheduledTaskHandle;
  cancel(id: string): boolean;
  cancelAll(): void;
}

export interface ModeModelAccess {
  list(): readonly ModeModelProvider[];
  resolve(role: ModeModelRole): ModeModelProvider | undefined;
}

export interface ModeStateAccess {
  get<T = unknown>(id: string): Awaitable<T | undefined>;
  set<T = unknown>(id: string, value: T): Awaitable<void>;
}

export interface ModeDeliveryAccess {
  deliver(kind: ModeDeliveryKind, target: unknown, payload: unknown): Awaitable<unknown>;
}

export interface ModeMediaAccess {
  list(): readonly unknown[];
  save(ref: unknown): Awaitable<unknown>;
}

export interface ModeBodyAccess {
  dispatch<T>(bodyId: string, kind: string, data: T): PerceptEvent<T>;
  act(bodyId: string, actuatorId: string, action: unknown, options?: ActuatorOptions): Promise<ActuatorResult>;
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
  readonly model?: ModeModelAccess;
  readonly state?: ModeStateAccess;
  readonly delivery?: ModeDeliveryAccess;
  readonly media?: ModeMediaAccess;
}

export interface PerceptHookContext {
  readonly lifeId?: string;
  readonly modeId: string;
  readonly session?: Session;
}

export interface ModeHooks {
  onPercept?(event: PerceptEvent, context: PerceptHookContext): Awaitable<boolean | void>;
}

export interface ModeProviders {
  readonly memory?: MemoryProvider | readonly MemoryProvider[];
  readonly model?: ModeModelProvider | readonly ModeModelProvider[];
  readonly state?: ModeStateProvider | readonly ModeStateProvider[];
  readonly delivery?: ModeDeliveryProvider | readonly ModeDeliveryProvider[];
  readonly scheduler?: ModeSchedulerProvider | readonly ModeSchedulerProvider[];
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
  readonly hooks?: ModeHooks;
  readonly providers?: ModeProviders;
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
  hooks?: ModeHooks;
  providers?: ModeProviders;
}
