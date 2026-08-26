import type { CortexAction, CortexEnactVerdict } from "@athena-ai/protocol";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import * as ContentFilter from "../src/index.js";

const action = (text: string): CortexAction => ({
  id: `action-${text}`,
  type: "send_message",
  text,
  data: { content: text },
});

describe("plugin-content-filter", () => {
  it("vetoes an action containing a blocked term", async () => {
    const ctx = new Context();
    await ctx.plugin(ContentFilter, { blocked: ["spam"] });

    const verdict = ctx.bail("cortex/before-enact", action("please remove this spam"));

    expect(verdict).toEqual<CortexEnactVerdict | void>({
      vetoed: true,
      reason: `content-filter blocked "send_message" (action-please remove this spam)`,
    });
    await ctx.fiber.dispose();
  });

  it("allows actions that do not match", async () => {
    const ctx = new Context();
    await ctx.plugin(ContentFilter, { blocked: ["spam"] });

    const verdict = ctx.bail("cortex/before-enact", action("hello there"));

    expect(verdict).toBeUndefined();
    await ctx.fiber.dispose();
  });

  it("stops guarding after plugin disposal", async () => {
    const ctx = new Context();
    const fiber = await ctx.plugin(ContentFilter, { blocked: ["spam"] });
    await fiber.dispose();

    const verdict = ctx.bail("cortex/before-enact", action("spam"));

    expect(verdict).toBeUndefined();
    await ctx.fiber.dispose();
  });

  it("does not error when the Cortex never emits before-enact", async () => {
    const ctx = new Context();
    await ctx.plugin(ContentFilter, { blocked: ["spam"] });

    expect(ctx.events).toBeDefined();
    await ctx.fiber.dispose();
  });
});
