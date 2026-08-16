import type { Awaitable } from "../internal.js";

export type SchedulingKind = "none" | "event" | "timer" | "tingle" | "due-intent" | "sweep" | "auto-advance" | "custom";

export interface ScheduledTaskContext {
  readonly id: string;
  readonly lifeId?: string;
  readonly owner?: string;
  readonly kind: SchedulingKind;
  readonly at: number;
}

export interface ScheduledTaskOptions {
  readonly lifeId?: string;
  readonly owner?: string;
  readonly kind: SchedulingKind;
  readonly at?: number;
  readonly after?: number;
  readonly interval?: number;
  readonly payload?: unknown;
  readonly run: (context: ScheduledTaskContext) => Awaitable<void>;
}

export interface ScheduledTaskHandle {
  readonly id: string;
  readonly kind: SchedulingKind;
  readonly nextRunAt: number;
  cancel(): boolean;
}

export interface ModeSchedulerAccess {
  schedule(options: Omit<ScheduledTaskOptions, "lifeId" | "owner">): ScheduledTaskHandle;
  cancel(id: string): boolean;
  cancelAll(): void;
}
