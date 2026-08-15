import { sessionStore } from "@yesimbot/harness-core";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { bodyRegistry } from "../src/body/index.js";
import { lifeRegistry } from "../src/life/index.js";
import { modeRegistry } from "../src/mode/index.js";
import type { Mode } from "../src/mode/types.js";

describe("life and mode registries", () => {
  it("creates and disposes a life", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const handle = ctx.lives.create({ id: "life-1" });
    expect(ctx.lives.get("life-1")).toBe(handle.life);

    await ctx.lives.dispose("life-1");
    expect(ctx.lives.get("life-1")).toBeUndefined();

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("registers mode definitions without implementing them", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(modeRegistry);
    await fiber;

    const mode: Mode = {
      name: "chat",
      setup: async () => ({}),
    };
    ctx.modes.register(mode);
    expect(ctx.modes.get("chat")).toBe(mode);
    expect(ctx.modes.list()).toEqual([mode]);

    await fiber.dispose();
  });

  it("routes percepts from a life to its active mode", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const percepts: string[] = [];
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        handle: async (event) => {
          percepts.push(event.kind);
          return true;
        },
      }),
    });
    const handle = ctx.lives.create({ id: "life-2" });
    await handle.setMode(await ctx.modes.create("chat", {}));

    const handled = await handle.dispatchPercept({
      id: "percept-1",
      time: Date.now(),
      bodyId: "im",
      kind: "message-created",
      data: { text: "hello" },
    });
    expect(handled).toBe(true);
    expect(percepts).toEqual(["message-created"]);

    await ctx.lives.dispose("life-2");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("routes body percept events to attached lives", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(bodyRegistry), ctx.plugin(sessionStore), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const percepts: string[] = [];
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        handle: async (event) => {
          percepts.push(event.kind);
          return true;
        },
      }),
    });
    ctx.bodies.register({
      id: "im",
      state: {},
    });
    const handle = ctx.lives.create({ id: "life-3" });
    await handle.attachBody("im");
    await handle.setMode(await ctx.modes.create("chat", {}));

    ctx.bodies.dispatch("im", "message-created", { text: "hello" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(percepts).toEqual(["message-created"]);

    await ctx.lives.dispose("life-3");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("starts the new mode and stops/disposes the previous mode", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const events: string[] = [];
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        start: async () => {
          events.push("chat.start");
        },
        stop: async () => {
          events.push("chat.stop");
        },
        handle: async () => true,
      }),
    });
    ctx.modes.register({
      name: "world",
      setup: async () => ({
        start: async () => {
          events.push("world.start");
        },
        stop: async () => {
          events.push("world.stop");
        },
        handle: async () => true,
      }),
    });

    const handle = ctx.lives.create({ id: "life-switch" });
    await handle.setMode(await ctx.modes.create("chat", {}));
    await handle.setMode(await ctx.modes.create("world", {}));
    expect(events).toEqual(["chat.start", "chat.stop", "world.start"]);

    await ctx.lives.dispose("life-switch");
    expect(events).toEqual(["chat.start", "chat.stop", "world.start", "world.stop"]);
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("clears the active mode when mode start fails", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    ctx.modes.register({
      name: "broken",
      setup: async () => ({
        start: async () => {
          throw new Error("start failed");
        },
        stop: async () => {},
      }),
    });

    const handle = ctx.lives.create({ id: "life-fail" });
    await expect(handle.setMode(await ctx.modes.create("broken", {}))).rejects.toThrow("start failed");
    expect(handle.activeModeId).toBeUndefined();

    await ctx.lives.dispose("life-fail");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("clears active mode and detached body after plugin-style disposal", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(bodyRegistry), ctx.plugin(sessionStore), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const disposeMode = ctx.modes.register({
      name: "chat",
      setup: async () => ({
        handle: async () => true,
      }),
    });
    const disposeBody = ctx.bodies.register({
      id: "im",
      state: {},
    });

    const handle = ctx.lives.create({ id: "life-hot" });
    await handle.attachBody("im");
    const mode = await ctx.modes.create("chat", {});
    await handle.setMode(mode);
    expect(handle.activeModeId).toBe(mode.id);
    expect(handle.life.bodyIds).toEqual(["im"]);

    await disposeMode();
    await disposeBody();

    expect(handle.activeModeId).toBeUndefined();
    expect(handle.life.bodyIds).toEqual([]);
    await expect(handle.dispatchPercept({ id: "p", time: Date.now(), bodyId: "im", kind: "x", data: {} })).resolves.toBe(false);

    await ctx.lives.dispose("life-hot");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("disposes created mode instances when the registry stops", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(modeRegistry);
    await fiber;

    const stops: string[] = [];
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        stop: async () => {
          stops.push("chat");
        },
      }),
    });
    await ctx.modes.create("chat", {});

    await fiber.dispose();
    expect(stops).toEqual(["chat"]);
  });
});
