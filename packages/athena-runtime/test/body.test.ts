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

  it("carries PerceptEvent envelope metadata", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    ctx.bodies.register({ id: "minecraft", state: {} });
    const event = ctx.bodies.dispatch(
      "minecraft",
      "world/observation",
      { block: "dirt" },
      {
        source: "adapter",
        priority: 1,
        target: { id: "channel-1", kind: "group" },
        meta: { visible: true },
      },
    );

    expect(event.source).toBe("adapter");
    expect(event.priority).toBe(1);
    expect(event.target).toEqual({ id: "channel-1", kind: "group" });
    expect(event.meta).toEqual({ visible: true });

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
    const executed: unknown[] = [];
    ctx.on("actuator/executed", (event) => executed.push(event));
    ctx.bodies.register({
      id: "im",
      state: {},
      actuators: [
        {
          id: "send",
          kind: "chat",
          act: async (action) => {
            actions.push(String(action));
            return { status: "ok", output: { ok: true } };
          },
        },
      ],
    });

    const result = await ctx.bodies.act("im", "send", "hello");
    expect(actions).toEqual(["hello"]);
    expect(result).toMatchObject({ status: "ok", output: { ok: true } });
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({ bodyId: "im", actuatorId: "send" });
    await expect(ctx.bodies.act("im", "missing", {})).rejects.toThrow(/Actuator not found/);

    await fiber.dispose();
  });

  it("returns ActuatorResult and retries retryable errors", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    let calls = 0;
    ctx.bodies.register({
      id: "retry",
      state: {},
      actuators: [
        {
          id: "flaky",
          act: async () => {
            calls++;
            if (calls < 3) return { status: "error", error: new Error("flaky"), retryable: true };
            return { status: "ok", output: "done" };
          },
        },
      ],
    });

    const result = await ctx.bodies.act("retry", "flaky", {}, { retries: 2 });
    expect(calls).toBe(3);
    expect(result).toMatchObject({ status: "ok", output: "done" });

    await fiber.dispose();
  });

  it("passes Body/Life/Mode context to actuators", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    let seen: unknown;
    ctx.bodies.register({
      id: "im",
      state: {},
      actuators: [
        {
          id: "send",
          act: async (_action, context) => {
            seen = context;
            return { status: "ok", output: null };
          },
        },
      ],
    });

    await ctx.bodies.act(
      "im",
      "send",
      {},
      {
        lifeId: "life-1",
        modeId: "mode-1",
        delivery: { kind: "message" },
        media: { id: "m1" },
      },
    );
    expect(seen).toMatchObject({
      bodyId: "im",
      lifeId: "life-1",
      modeId: "mode-1",
      attempt: 0,
      delivery: { kind: "message" },
      media: { id: "m1" },
    });

    await fiber.dispose();
  });

  it("returns canceled ActuatorResult when the signal is aborted", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(bodyRegistry);
    await fiber;

    ctx.bodies.register({
      id: "cancel",
      state: {},
      actuators: [{ id: "slow", act: async () => ({ status: "ok", output: "never" }) }],
    });
    const controller = new AbortController();
    controller.abort("stop");

    const result = await ctx.bodies.act("cancel", "slow", {}, { signal: controller.signal, retries: 2 });
    expect(result.status).toBe("canceled");
    expect(result.error).toBe("stop");

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
      state: { online: true },
      senses: [{ id: "message", kind: "chat" }],
      actuators: [
        {
          id: "send",
          kind: "chat",
          act: async () => ({ status: "ok", output: { ok: true } }),
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
    expect(ctx.bodies.get("onebot")?.state).toEqual({ online: true });
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
