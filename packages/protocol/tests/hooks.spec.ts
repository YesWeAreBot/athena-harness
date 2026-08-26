import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import type { CortexAction, CortexContext, CortexEnactVerdict, CognitionParams, EnactResult, PerceptionEvent } from "../src/hooks.js";

const event = (id: string, source = "sandbox:alice"): PerceptionEvent => ({
  id,
  type: "message-created",
  source,
  timestamp: Date.now(),
});

async function install(ctx: Context, listener: (events: PerceptionEvent[], next: () => PerceptionEvent[]) => PerceptionEvent[]): Promise<void> {
  await ctx.plugin(() => {
    ctx.on("cortex/before-drain", listener);
  });
}

describe("Cortex Hook Protocol", () => {
  it("emits before-drain as a waterfall chain", async () => {
    const ctx = new Context();
    await install(ctx, (events, next) => {
      events.splice(0, events.length, ...events.filter((item) => item.source !== "blocked"));
      return next();
    });

    const result = ctx.waterfall("cortex/before-drain", [event("1"), event("2", "blocked"), event("3")], (events) => events);

    expect(result.map((item) => item.id)).toEqual(["1", "3"]);
    await ctx.fiber.dispose();
  });

  it("allows a before-drain listener to short-circuit without calling next", async () => {
    const ctx = new Context();
    let innerCalled = false;
    await install(ctx, (events, next) => {
      if (events.length > 1) return [];
      return next();
    });

    const result = ctx.waterfall("cortex/before-drain", [event("1"), event("2")], (events) => {
      innerCalled = true;
      return events;
    });

    expect(result).toEqual([]);
    expect(innerCalled).toBe(false);
    await ctx.fiber.dispose();
  });

  it("injects content through after-integrate", async () => {
    const ctx = new Context();
    await ctx.plugin(() => {
      ctx.on("cortex/after-integrate", (context: CortexContext, next: () => CortexContext) => {
        context.sections.push("memory: remembered detail");
        return next();
      });
    });

    const context: CortexContext = {
      cycleId: "cycle-1",
      events: [event("1")],
      sections: ["persona: Alice"],
    };
    const result = ctx.waterfall("cortex/after-integrate", context, (value) => value);

    expect(result.sections).toEqual(["persona: Alice", "memory: remembered detail"]);
    await ctx.fiber.dispose();
  });

  it("mutates cognition parameters through before-cognition", async () => {
    const ctx = new Context();
    await ctx.plugin(() => {
      ctx.on("cortex/before-cognition", (params: CognitionParams, next: () => CognitionParams) => {
        params.systemPrompt += "\nBe concise.";
        params.tools.push("remember");
        params.settings.temperature = 0.2;
        return next();
      });
    });

    const params: CognitionParams = {
      cycleId: "cycle-1",
      context: {
        cycleId: "cycle-1",
        events: [event("1")],
        sections: ["persona: Alice"],
      },
      systemPrompt: "You are Alice.",
      tools: ["send_message"],
      settings: {},
    };
    const result = ctx.waterfall("cortex/before-cognition", params, (value) => value);

    expect(result.systemPrompt).toContain("Be concise.");
    expect(result.tools).toEqual(["send_message", "remember"]);
    expect(result.settings.temperature).toBe(0.2);
    await ctx.fiber.dispose();
  });

  it("returns a structured verdict when before-enact bails", async () => {
    const ctx = new Context();
    await ctx.plugin(() => {
      ctx.on("cortex/before-enact", (): CortexEnactVerdict | void => {
        return { vetoed: true, reason: "blocked by content filter" };
      });
    });

    const action: CortexAction = {
      id: "action-1",
      type: "send_message",
      text: "spam",
    };
    const verdict = ctx.bail("cortex/before-enact", action);

    expect(verdict).toEqual({ vetoed: true, reason: "blocked by content filter" });
    await ctx.fiber.dispose();
  });

  it("returns undefined from before-enact when no listener bails", async () => {
    const ctx = new Context();
    const action: CortexAction = {
      id: "action-2",
      type: "send_message",
      text: "hello",
    };

    expect(ctx.bail("cortex/before-enact", action)).toBeUndefined();
    await ctx.fiber.dispose();
  });

  it("runs after-enact listeners as parallel side effects", async () => {
    const ctx = new Context();
    const observed: string[] = [];
    await ctx.plugin(() => {
      ctx.on("cortex/after-enact", (results: EnactResult[]) => {
        observed.push(results[0]!.actionId);
      });
    });

    const results: EnactResult[] = [{ actionId: "action-3", ok: true }];
    await ctx.parallel("cortex/after-enact", results);

    expect(observed).toEqual(["action-3"]);
    await ctx.fiber.dispose();
  });

  it("does not error when a Cortex never emits a hook", async () => {
    const ctx = new Context();
    await ctx.plugin(() => {
      ctx.on("cortex/before-enact", () => {
        throw new Error("must not run");
      });
    });

    expect(ctx.events).toBeDefined();
    await ctx.fiber.dispose();
  });
});
