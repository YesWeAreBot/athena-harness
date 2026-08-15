import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { bodyRegistry } from "../src/body/index.js";
import type { PerceptEvent } from "../src/body/types.js";

describe("body registry", () => {
  it("registers a body and dispatches percept events", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    const percepts: PerceptEvent[] = [];
    ctx.on("body/percept", (event) => percepts.push(event));

    const disposeBody = ctx.bodies.register({
      id: "minecraft",
      state: { dimension: "overworld" },
      senses: [{ id: "vision", kind: "world" }],
      actuators: [{ id: "move", kind: "world" }],
    });

    const event = ctx.bodies.dispatch("minecraft", "world/observation", {
      block: "dirt",
    });

    expect(event.bodyId).toBe("minecraft");
    expect(event.kind).toBe("world/observation");
    expect(percepts).toHaveLength(1);
    expect(percepts[0]).toBe(event);
    expect(Object.isFrozen(event.data)).toBe(true);

    disposeBody();
    expect(ctx.bodies.get("minecraft")).toBeUndefined();

    await fiber.dispose();
  });

  it("rejects percepts from unregistered bodies", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    expect(() => ctx.bodies.dispatch("ghost", "world/observation", {})).toThrow(/Body not registered/);

    await fiber.dispose();
  });
});
