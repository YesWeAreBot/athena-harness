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

  it("applies Life percept attention and compact pipeline before routing", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const received: string[] = [];
    const rejected: unknown[] = [];
    ctx.on("percept/rejected", (event) => rejected.push(event));
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        handle: async (event) => {
          received.push(event.kind);
          return true;
        },
      }),
    });

    const handle = ctx.lives.create({
      id: "life-pipeline",
      perceptPipeline: {
        attention: (event) => event.bodyId === "im",
        compact: (event) => ({ ...event, id: `compact:${event.id}`, kind: `compact:${event.kind}` }),
      },
    });
    await handle.setMode(await ctx.modes.create("chat", {}));

    await handle.dispatchPercept({
      id: "percept-ignored",
      time: Date.now(),
      bodyId: "minecraft",
      kind: "world/observation",
      data: {},
    });
    await handle.dispatchPercept({
      id: "percept-compacted",
      time: Date.now(),
      bodyId: "im",
      kind: "message-created",
      data: { text: "hi" },
    });

    expect(received).toEqual(["compact:message-created"]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({ id: "life-pipeline", reason: "attention" });

    await ctx.lives.dispose("life-pipeline");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("wakes Life through a Life-level wake Percept", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const received: unknown[] = [];
    ctx.modes.register({
      name: "chat",
      capabilities: {
        driver: "finite-tool-loop",
        percepts: [{ body: "life", kind: "wake" }],
        actuators: [],
        scheduling: ["event"],
        memory: [],
        productState: [],
      },
      setup: async () => ({
        handle: async (event) => {
          received.push(event.data);
          return true;
        },
      }),
    });

    const handle = ctx.lives.create({ id: "life-wake" });
    await handle.createMode("chat", {});
    await expect(handle.wake("world.tingle", { t: 1 })).resolves.toBe(true);
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ reason: "world.tingle", data: { t: 1 } });

    await ctx.lives.dispose("life-wake");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("supports Mode hooks as the percept entry point", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const seen: string[] = [];
    ctx.modes.register({
      name: "hook-mode",
      setup: async () => ({
        hooks: {
          onPercept: async (event, hookContext) => {
            seen.push(`${event.kind}:${hookContext.modeId}`);
            return event.kind === "accepted";
          },
        },
      }),
    });

    const handle = ctx.lives.create({ id: "life-hook-mode" });
    await handle.setMode(await ctx.modes.create("hook-mode", {}));

    await expect(
      handle.dispatchPercept({
        id: "percept-hook-rejected",
        time: Date.now(),
        bodyId: "im",
        kind: "rejected",
        data: {},
      }),
    ).resolves.toBe(false);
    await expect(
      handle.dispatchPercept({
        id: "percept-hook-accepted",
        time: Date.now(),
        bodyId: "im",
        kind: "accepted",
        data: {},
      }),
    ).resolves.toBe(true);
    expect(seen).toHaveLength(2);

    await ctx.lives.dispose("life-hook-mode");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("registers and unregisters Mode memory providers on Life memory", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(modeRegistry), ctx.plugin(memoryRegistry), ctx.plugin(lifeRegistry)];
    await Promise.all(fibers);

    let calls = 0;
    let restoreCalls = 0;
    const provider = {
      id: "mode-story",
      scopes: ["story"],
      remember: async (input: { lifeId: string; scope: string; category: string; content: string }) => {
        calls++;
        return {
          id: "story-1",
          lifeId: input.lifeId,
          scope: input.scope,
          category: input.category,
          content: input.content,
          importance: 0.5,
          confidence: 0.5,
          createdAt: Date.now(),
        };
      },
      recall: async () => [],
      restore: async () => {
        restoreCalls++;
      },
      forget: async () => true,
      clear: async () => {},
    };
    ctx.modes.register({
      name: "story",
      setup: async () => ({
        providers: { memory: provider },
      }),
    });

    const handle = ctx.lives.create({ id: "life-memory-provider" });
    const mode = await handle.createMode("story", {});
    expect(restoreCalls).toBe(1);
    expect(ctx.memory.listProviders().map((item) => item.id)).toEqual(["mode-story"]);

    await ctx.memory.remember({
      lifeId: "life-memory-provider",
      scope: "story",
      category: "arc",
      content: "story content",
    });
    expect(calls).toBe(1);

    await ctx.modes.dispose(mode.id);
    expect(ctx.memory.listProviders()).toEqual([]);

    await ctx.lives.dispose("life-memory-provider");
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("exposes active Mode model/state/delivery providers through ModeContext", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    let captured: unknown;
    let stateUpdated: unknown;
    const disposed: string[] = [];
    let stateRestores = 0;
    let statePersists = 0;
    const modelProvider = {
      id: "main-model",
      roles: ["main"] as const,
      get: async () => ({ id: "model-a" }),
      dispose: async () => {
        disposed.push("model");
      },
    };
    const stateProvider = {
      id: "story-state",
      kinds: ["story"] as const,
      get: async () => ({ arc: "arc-1" }),
      set: async (next: unknown) => {
        stateUpdated = next;
      },
      restore: async () => {
        stateRestores++;
      },
      persist: async () => {
        statePersists++;
      },
      dispose: async () => {
        disposed.push("state");
      },
    };
    const deliveryProvider = {
      id: "chat-delivery",
      kinds: ["message"] as const,
      deliver: async () => ({ id: "delivery-1", status: "delivered" as const }),
      schedule: async () => ({ id: "delivery-2", status: "delayed" as const, scheduledAt: Date.now() + 1000 }),
      cancel: async () => true,
      dispose: async () => {
        disposed.push("delivery");
      },
    };
    const mediaProvider = {
      id: "media-store",
      list: async () => ["m1"],
      save: async (ref: unknown) => ({ id: "saved", ref }),
      dispose: async () => {
        disposed.push("media");
      },
    };
    ctx.modes.register({
      name: "providers",
      setup: async (modeCtx) => {
        captured = modeCtx;
        return {
          providers: {
            model: modelProvider,
            state: stateProvider,
            delivery: deliveryProvider,
            media: mediaProvider,
          },
        };
      },
    });

    const handle = ctx.lives.create({ id: "life-mode-providers" });
    await handle.createMode("providers", {});
    expect(stateRestores).toBe(1);

    const modeCtx = captured as {
      model?: { resolve(role: string): { id?: string } | undefined };
      state?: { get<T>(id: string): Promise<T | undefined>; set(id: string, value: unknown): Promise<void> };
      delivery?: {
        deliver(kind: string, target: unknown, payload: unknown): Promise<unknown>;
        schedule(delivery: { kind: string; target: unknown; payload: unknown; at: number }): Promise<unknown>;
        cancel(id: string): Promise<boolean>;
      };
      media?: { list(): Promise<unknown[]>; save(ref: unknown): Promise<unknown> };
    };
    expect(modeCtx.model?.resolve("main")?.id).toBe("main-model");
    await expect(modeCtx.state!.get("story-state")).resolves.toEqual({ arc: "arc-1" });
    await modeCtx.state!.set("story-state", { arc: "arc-2" });
    expect(stateUpdated).toEqual({ arc: "arc-2" });
    await expect(modeCtx.delivery!.deliver("message", { channel: "1" }, { text: "hi" })).resolves.toMatchObject({ status: "delivered" });
    await expect(
      modeCtx.delivery!.schedule({ kind: "message", target: {}, payload: {}, at: Date.now() + 1000 }),
    ).resolves.toMatchObject({ status: "delayed" });
    await expect(modeCtx.delivery!.cancel("delivery-2")).resolves.toBe(true);
    await expect(modeCtx.media!.list()).resolves.toEqual(["m1"]);
    await expect(modeCtx.media!.save({ type: "image" })).resolves.toMatchObject({ id: "saved" });
    await expect(handle.getState("story-state")).resolves.toEqual({ arc: "arc-1" });
    await handle.setState("story-state", { arc: "arc-3" });
    expect(stateUpdated).toEqual({ arc: "arc-3" });
    await expect(handle.deliver("message", { channel: "1" }, { text: "hi" })).resolves.toMatchObject({ status: "delivered" });
    await expect(
      handle.scheduleDelivery({ kind: "message", target: {}, payload: {}, at: Date.now() + 1000 }),
    ).resolves.toMatchObject({ status: "delayed" });
    await expect(handle.cancelDelivery("delivery-2")).resolves.toBe(true);

    await ctx.lives.dispose("life-mode-providers");
    expect(statePersists).toBe(1);
    expect(disposed.sort()).toEqual(["delivery", "media", "model", "state"]);
    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("persists old state and restores new state on Mode switch", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    let chatPersist = 0;
    let chatRestore = 0;
    let worldPersist = 0;
    let worldRestore = 0;
    const chatState = {
      id: "chat-state",
      kinds: ["story"] as const,
      get: async () => ({}),
      set: async () => {},
      persist: async () => {
        chatPersist++;
      },
      restore: async () => {
        chatRestore++;
      },
    };
    const worldState = {
      id: "world-state",
      kinds: ["world"] as const,
      get: async () => ({}),
      set: async () => {},
      persist: async () => {
        worldPersist++;
      },
      restore: async () => {
        worldRestore++;
      },
    };
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        providers: { state: chatState },
      }),
    });
    ctx.modes.register({
      name: "world",
      setup: async () => ({
        providers: { state: worldState },
      }),
    });

    const handle = ctx.lives.create({ id: "life-switch-state" });
    await handle.createMode("chat", {});
    expect(chatRestore).toBe(1);

    await handle.setMode(await ctx.modes.create("world", {}));
    expect(chatPersist).toBeGreaterThanOrEqual(1);
    expect(worldRestore).toBe(1);

    await ctx.lives.dispose("life-switch-state");
    expect(worldPersist).toBe(1);

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

  it("emits Life lifecycle and percept routing events", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry), ctx.plugin(modeRegistry)];
    await Promise.all(fibers);

    const lifecycle: string[] = [];
    const routed: unknown[] = [];
    ctx.on("life/created", (event) => lifecycle.push(`created:${event.id}`));
    ctx.on("life/disposed", (event) => lifecycle.push(`disposed:${event.id}`));
    ctx.on("percept/routed", (event) => routed.push(event));
    ctx.modes.register({
      name: "chat",
      setup: async () => ({
        handle: async () => true,
      }),
    });

    const handle = ctx.lives.create({ id: "life-events" });
    await handle.setMode(await ctx.modes.create("chat", {}));
    await handle.dispatchPercept({
      id: "percept-routed",
      time: Date.now(),
      bodyId: "im",
      kind: "message-created",
      data: {},
    });

    expect(lifecycle).toEqual(["created:life-events"]);
    expect(routed).toHaveLength(1);
    expect(routed[0]).toMatchObject({ id: "life-events", handled: true });

    await ctx.lives.dispose("life-events");
    expect(lifecycle).toEqual(["created:life-events", "disposed:life-events"]);

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
      actuators: [{ id: "move", kind: "world", act: async () => ({ status: "ok", output: "ok" }) }],
    });
    ctx.bodies.register({
      id: "im",
      state: {},
      actuators: [{ id: "send", kind: "chat", act: async () => ({ status: "ok", output: "ok" }) }],
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
        await expect(modeCtx.bodies!.act("minecraft", "move", {})).resolves.toMatchObject({ status: "ok", output: "ok" });
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
    await new Promise((resolve) => setTimeout(resolve, 0));

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
    expect(handle.disposed).toBe(true);
    expect(handle.life.disposed).toBe(true);

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
