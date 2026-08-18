import { Service } from "cordis";
import type { Context } from "cordis";

import { createId } from "../internal.js";
import type { ScheduledTaskHandle, ScheduledTaskOptions } from "./types.js";

interface ScheduledTask {
  readonly options: ScheduledTaskOptions;
  readonly id: string;
  cancelled: boolean;
  nextRunAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

declare module "cordis" {
  interface Context {
    scheduler: Scheduler;
  }
}

/**
 * @experimental Replaceable Scheduler service.
 */
export abstract class Scheduler extends Service {
  static provide = "scheduler";

  constructor(ctx: Context) {
    super(ctx, "scheduler");
  }

  abstract schedule(options: ScheduledTaskOptions): ScheduledTaskHandle;

  abstract cancel(id: string): boolean;

  abstract cancelByLife(lifeId: string): void;

  abstract cancelByOwner(owner: string): void;

  abstract stopAll(): void;
}

export class SchedulerRegistry extends Scheduler {
  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(ctx: Context) {
    super(ctx);
    this.ctx.effect(() => async () => {
      this.stopAll();
    });
  }

  override schedule(options: ScheduledTaskOptions): ScheduledTaskHandle {
    const id = createId("task");
    const at = options.at ?? (options.after === undefined ? Date.now() : Date.now() + options.after);
    const task: ScheduledTask = {
      id,
      options,
      cancelled: false,
      nextRunAt: at,
    };
    this.tasks.set(id, task);
    task.timer = setTimeout(
      () => {
        void this.fire(id);
      },
      Math.max(0, at - Date.now()),
    );
    task.timer.unref?.();
    return {
      id,
      kind: options.kind,
      get nextRunAt() {
        return task.nextRunAt;
      },
      cancel: () => this.cancel(id),
    };
  }

  override cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.cancelled) return false;
    task.cancelled = true;
    if (task.timer) clearTimeout(task.timer);
    this.tasks.delete(id);
    return true;
  }

  override cancelByLife(lifeId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.options.lifeId === lifeId) this.cancel(id);
    }
  }

  override cancelByOwner(owner: string): void {
    for (const [id, task] of this.tasks) {
      if (task.options.owner === owner) this.cancel(id);
    }
  }

  override stopAll(): void {
    for (const task of this.tasks.values()) {
      task.cancelled = true;
      if (task.timer) clearTimeout(task.timer);
    }
    this.tasks.clear();
  }

  private async fire(id: string): Promise<void> {
    const task = this.tasks.get(id);
    if (!task || task.cancelled) return;
    task.nextRunAt = Date.now();
    try {
      await task.options.run({
        id: task.id,
        lifeId: task.options.lifeId,
        owner: task.options.owner,
        kind: task.options.kind,
        at: task.nextRunAt,
      });
    } catch {
      // Task failures must not tear down the scheduler registry.
    }
    if (task.cancelled) return;
    if (task.options.interval !== undefined && task.options.interval > 0) {
      task.nextRunAt = Date.now() + task.options.interval;
      task.timer = setTimeout(() => {
        void this.fire(id);
      }, task.options.interval);
      task.timer.unref?.();
    } else {
      this.tasks.delete(id);
    }
  }
}

export type { ModeSchedulerAccess, ScheduledTaskContext, ScheduledTaskHandle, ScheduledTaskOptions, SchedulingKind } from "./types.js";
