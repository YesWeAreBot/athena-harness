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
});
