import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { schedulerRegistry } from "../src/scheduler/index.js";

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
});
