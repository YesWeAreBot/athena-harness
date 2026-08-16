import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { createId } from "../src/internal.js";
import { Scheduler, schedulerRegistry } from "../src/scheduler/index.js";
import type { ScheduledTaskHandle, ScheduledTaskOptions } from "../src/scheduler/types.js";

describe("scheduler infrastructure", () => {
  it("runs scheduled tasks and supports cancellation", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(schedulerRegistry);
    await fiber;

    const events: string[] = [];
    ctx.scheduler.schedule({
      kind: "timer",
      after: 10,
      run: async () => {
        events.push("run");
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(events).toEqual(["run"]);

    const cancelled = ctx.scheduler.schedule({
      kind: "timer",
      after: 10,
      run: async () => {
        events.push("cancelled");
      },
    });
    expect(cancelled.cancel()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual(["run"]);

    await fiber.dispose();
  });

  it("cancels tasks by life and owner", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(schedulerRegistry);
    await fiber;

    const events: string[] = [];
    ctx.scheduler.schedule({
      lifeId: "life-a",
      owner: "mode-a",
      kind: "tingle",
      after: 10,
      run: async () => {
        events.push("a");
      },
    });
    ctx.scheduler.schedule({
      lifeId: "life-b",
      owner: "mode-b",
      kind: "due-intent",
      after: 10,
      run: async () => {
        events.push("b");
      },
    });

    ctx.scheduler.cancelByLife("life-a");
    ctx.scheduler.cancelByOwner("mode-b");
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);

    await fiber.dispose();
  });

  it("allows third-party Scheduler providers to replace the default", async () => {
    class CustomScheduler extends Scheduler {
      readonly scheduled: string[] = [];

      constructor(ctx: Context) {
        super(ctx);
      }

      override schedule(options: ScheduledTaskOptions): ScheduledTaskHandle {
        const id = createId("custom-task");
        this.scheduled.push(id);
        return {
          id,
          kind: options.kind,
          nextRunAt: options.at ?? Date.now(),
          cancel: () => false,
        };
      }

      override cancel(): boolean {
        return false;
      }

      override cancelByLife(): void {}

      override cancelByOwner(): void {}

      override stopAll(): void {
        this.scheduled.length = 0;
      }
    }

    const ctx = new Context();
    const fiber = ctx.plugin({
      apply(next) {
        next.scheduler = new CustomScheduler(next) as never;
      },
    });
    await fiber;

    ctx.scheduler.schedule({ kind: "timer", after: 0, run: async () => {} });
    expect(ctx.scheduler).toBeInstanceOf(CustomScheduler);
    expect((ctx.scheduler as CustomScheduler).scheduled).toHaveLength(1);

    await fiber.dispose();
  });
});
