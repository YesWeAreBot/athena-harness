import { createId } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { ScheduledTaskHandle, ScheduledTaskOptions } from "./types.js";

interface ScheduledTask {
  readonly options: ScheduledTaskOptions;
  readonly id: string;
  cancelled: boolean;
  nextRunAt: number;
  timer?: ReturnType<typeof setTimeout>;
}

export class SchedulerRegistry extends Service {
  static provide = "scheduler";

  private readonly tasks = new Map<string, ScheduledTask>();

  constructor(ctx: Context) {
    super(ctx, "scheduler");
    this.ctx.effect(() => async () => {
      this.stopAll();
    });
  }

  schedule(options: ScheduledTaskOptions): ScheduledTaskHandle {
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

  cancel(id: string): boolean {
    const task = this.tasks.get(id);
    if (!task || task.cancelled) return false;
    task.cancelled = true;
    if (task.timer) clearTimeout(task.timer);
    this.tasks.delete(id);
    return true;
  }

  cancelByLife(lifeId: string): void {
    for (const [id, task] of this.tasks) {
      if (task.options.lifeId === lifeId) this.cancel(id);
    }
  }

  cancelByOwner(owner: string): void {
    for (const [id, task] of this.tasks) {
      if (task.options.owner === owner) this.cancel(id);
    }
  }

  stopAll(): void {
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

export const schedulerRegistry = {
  apply(ctx: Context) {
    new SchedulerRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    scheduler: SchedulerRegistry;
  }
}

export type { ModeSchedulerAccess, ScheduledTaskContext, ScheduledTaskHandle, ScheduledTaskOptions, SchedulingKind } from "./types.js";
