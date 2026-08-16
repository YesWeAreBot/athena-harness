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

  it("executes registered actuator actions", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    const actions: string[] = [];
    ctx.bodies.register({
      id: "im",
      state: {},
      actuators: [
        {
          id: "send",
          kind: "chat",
          act: async (action) => {
            actions.push(String(action));
            return { ok: true };
          },
        },
      ],
    });

    const result = await ctx.bodies.act("im", "send", "hello");
    expect(actions).toEqual(["hello"]);
    expect(result).toEqual({ ok: true });
    await expect(ctx.bodies.act("im", "missing", {})).rejects.toThrow(/Actuator not found/);

    await fiber.dispose();
  });

  it("registers a BodyAdapter and manages its start/stop lifecycle", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    const events: string[] = [];
    const dispose = await ctx.bodies.registerAdapter({
      id: "onebot",
      name: "OneBot",
      senses: [{ id: "message", kind: "chat" }],
      actuators: [
        {
          id: "send",
          kind: "chat",
          act: async () => ({ ok: true }),
        },
      ],
      start: async () => {
        events.push("start");
      },
      stop: async () => {
        events.push("stop");
      },
    });

    expect(ctx.bodies.get("onebot")?.name).toBe("OneBot");
    expect(events).toEqual(["start"]);

    await dispose();
    expect(events).toEqual(["start", "stop"]);
    expect(ctx.bodies.get("onebot")).toBeUndefined();

    await fiber.dispose();
  });

  it("rolls back a BodyAdapter when start fails", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    await expect(
      ctx.bodies.registerAdapter({
        id: "broken",
        start: async () => {
          throw new Error("start failed");
        },
      }),
    ).rejects.toThrow("start failed");
    expect(ctx.bodies.get("broken")).toBeUndefined();

    await fiber.dispose();
  });

  it("still disposes Body when adapter stop fails", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    const dispose = await ctx.bodies.registerAdapter({
      id: "stop-broken",
      start: async () => {},
      stop: async () => {
        throw new Error("stop failed");
      },
    });

    await expect(dispose()).rejects.toThrow("stop failed");
    expect(ctx.bodies.get("stop-broken")).toBeUndefined();

    await fiber.dispose();
  });
});
