import { SessionRegistry } from "@athena/session";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoopRegistry } from "../src/agent-loop/index.js";
import { bodyRegistry } from "../src/body/index.js";
import { lifeRegistry } from "../src/life/index.js";
import { memoryRegistry } from "../src/memory/index.js";
import { modeRegistry } from "../src/mode/index.js";
import type { Mode } from "../src/mode/types.js";
import { schedulerRegistry } from "../src/scheduler/index.js";

describe("life and mode registries", () => {
  it("creates and disposes a life", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry)];
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
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
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

  it("routes percepts only when Mode capabilities match", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const percepts: string[] = [];
    ctx.modes.register({
      name: "world",
      capabilities: {
        driver: "continuous-mailbox",
        percepts: [{ body: "minecraft", kind: "world/observation" }],
        actuators: [],
        scheduling: ["event"],
        memory: ["facts"],
        productState: ["world"],
        bodies: ["minecraft"],
      },
      setup: async () => ({
        handle: async (event) => {
          percepts.push(event.kind);
          return true;
        },
      }),
    });

    const handle = ctx.lives.create({ id: "life-capabilities" });
    await handle.attachBody("minecraft");
    await handle.attachBody("im");
    const mode = await ctx.modes.create("world", {});
    expect(mode.capabilities).toBeDefined();
    await handle.setMode(mode);

    await expect(
      handle.dispatchPercept({
        id: "percept-ignored",
        time: Date.now(),
        bodyId: "im",
        kind: "message-created",
        data: {},
      }),
    ).resolves.toBe(false);
    await expect(
      handle.dispatchPercept({
        id: "percept-accepted",
        time: Date.now(),
        bodyId: "minecraft",
        kind: "world/observation",
        data: { block: "dirt" },
      }),
    ).resolves.toBe(true);
    expect(percepts).toEqual(["world/observation"]);

    await ctx.lives.dispose("life-capabilities");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("routes body percept events to attached lives", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(bodyRegistry), ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
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

  it("emits life/error when Mode percept handler rejects", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(bodyRegistry), ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const errors: unknown[] = [];
    ctx.on("life/error", (event) => errors.push(event.error));
    ctx.modes.register({
      name: "broken",
      setup: async () => ({
        handle: async () => {
          throw new Error("boom");
        },
      }),
    });
    ctx.bodies.register({ id: "im", state: {} });

    const handle = ctx.lives.create({ id: "life-error" });
    await handle.attachBody("im");
    await handle.setMode(await ctx.modes.create("broken", {}));

    ctx.bodies.dispatch("im", "message-created", {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe("boom");

    await ctx.lives.dispose("life-error");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("starts the new mode and stops/disposes the previous mode", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
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
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
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

  it("disposes a created Mode when Life attach fails", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const disposed: string[] = [];
    ctx.on("mode/disposed", (event) => disposed.push(event.id));
    ctx.modes.register({
      name: "broken",
      setup: async () => ({
        start: async () => {
          throw new Error("start failed");
        },
        stop: async () => {},
      }),
    });

    const handle = ctx.lives.create({ id: "life-create-fail" });
    await expect(handle.createMode("broken", {})).rejects.toThrow("start failed");
    expect(disposed).toHaveLength(1);

    await ctx.lives.dispose("life-create-fail");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("gates Mode actuator access by capabilities", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(bodyRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    ctx.bodies.register({
      id: "minecraft",
      state: {},
      actuators: [{ id: "move", kind: "world", act: async () => "ok" }],
    });
    ctx.bodies.register({
      id: "im",
      state: {},
      actuators: [{ id: "send", kind: "chat", act: async () => "ok" }],
    });
    ctx.modes.register({
      name: "world",
      capabilities: {
        driver: "continuous-mailbox",
        percepts: [],
        actuators: [{ body: "minecraft", actuator: "move" }],
        scheduling: ["event"],
        memory: ["facts"],
        productState: ["world"],
        bodies: ["minecraft"],
      },
      setup: async (modeCtx) => {
        await expect(modeCtx.bodies!.act("im", "send", {})).rejects.toThrow(/not allowed/);
        await expect(modeCtx.bodies!.act("minecraft", "move", {})).resolves.toBe("ok");
        return {};
      },
    });

    const handle = ctx.lives.create({ id: "life-actuator-gate" });
    await handle.createMode("world", {});

    await ctx.lives.dispose("life-actuator-gate");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("clears active mode and detached body after plugin-style disposal", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(bodyRegistry), ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
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

  it("injects the full ModeContext through Life.createMode", async () => {
    const ctx = new Context();
    const fibers = [
      ctx.plugin(SessionRegistry),
      ctx.plugin(bodyRegistry),
      ctx.plugin(memoryRegistry),
      ctx.plugin(schedulerRegistry),
      ctx.plugin(agentLoopRegistry),
      ctx.plugin(modeRegistry),
      ctx.plugin(lifeRegistry),
    ];
    await Promise.all(fibers);

    let captured: unknown;
    ctx.modes.register({
      name: "chat",
      setup: async (modeCtx) => {
        captured = modeCtx;
        return {
          start: async () => {},
          handle: async () => true,
        };
      },
    });

    ctx.bodies.register({ id: "im", state: {} });
    const handle = ctx.lives.create({ id: "life-context" });
    await handle.attachBody("im");
    const mode = await handle.createMode("chat", {});

    expect(mode.name).toBe("chat");
    expect(handle.activeModeId).toBe(mode.id);
    const modeCtx = captured as {
      lifeId?: string;
      session?: unknown;
      bodies?: unknown;
      memory?: unknown;
      scheduler?: unknown;
      agentLoop?: unknown;
    };
    expect(modeCtx.lifeId).toBe("life-context");
    expect(modeCtx.session).toBe(handle.life.session);
    expect(modeCtx.bodies).toBeDefined();
    expect(modeCtx.memory).toBeDefined();
    expect(modeCtx.scheduler).toBeDefined();
    expect(modeCtx.agentLoop).toBeDefined();

    await ctx.lives.dispose("life-context");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("rejects Life resume when the session is missing", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    await expect(ctx.lives.resume({ id: "missing-life" })).rejects.toThrow(/not found/);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("cancels mode scheduler tasks when the mode is disposed", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry), ctx.plugin(schedulerRegistry)];
    await Promise.all(fibers);

    const events: string[] = [];
    ctx.modes.register({
      name: "chat",
      setup: async (modeCtx) => {
        modeCtx.scheduler?.schedule({
          kind: "timer",
          after: 10,
          run: async () => {
            events.push("run");
          },
        });
        return {
          start: async () => {},
          handle: async () => true,
        };
      },
    });

    const handle = ctx.lives.create({ id: "life-sched" });
    const mode = await handle.createMode("chat", {});
    await ctx.modes.dispose(mode.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(events).toEqual([]);

    await ctx.lives.dispose("life-sched");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("disposes a Life idempotently", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const handle = ctx.lives.create({ id: "life-idempotent" });
    await handle.dispose();
    await handle.dispose();
    expect(ctx.lives.get("life-idempotent")).toBeUndefined();

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("rejects detach after Life is disposed", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const handle = ctx.lives.create({ id: "life-detach-late" });
    await handle.dispose();
    await expect(handle.detachBody("im")).rejects.toThrow(/disposed/);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("rejects attaching an unregistered Body when BodyRegistry is installed", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(bodyRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const handle = ctx.lives.create({ id: "life-attach-invalid" });
    await expect(handle.attachBody("ghost")).rejects.toThrow(/not registered/);
    expect(handle.life.bodyIds).toEqual([]);

    await ctx.lives.dispose("life-attach-invalid");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("survives concurrent Life dispose and Mode definition unload", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(bodyRegistry), ctx.plugin(modeRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    const disposeMode = ctx.modes.register({
      name: "chat",
      setup: async () => ({
        start: async () => {},
        handle: async () => true,
      }),
    });
    const handle = ctx.lives.create({ id: "life-race" });
    await handle.setMode(await ctx.modes.create("chat", {}));

    await Promise.all([ctx.lives.dispose("life-race"), disposeMode()]);
    expect(ctx.lives.get("life-race")).toBeUndefined();

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
