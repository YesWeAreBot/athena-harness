import type { AgentHandle } from "@yesimbot/harness-core";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoopRegistry } from "../src/agent-loop/index.js";

describe("agent loop infrastructure", () => {
  it("registers providers and delegates create/resume", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(agentLoopRegistry);
    await fiber;

    const handle = { agent: {} as never, dispose: async () => {} } as AgentHandle;
    let created = 0;
    let resumed = 0;
    const disposeProvider = ctx.agentLoop.register({
      id: "mock",
      factory: {
        create: async () => {
          created++;
          return handle;
        },
        resume: async () => {
          resumed++;
          return handle;
        },
      },
    });

    expect(ctx.agentLoop.get("mock")?.id).toBe("mock");
    await expect(ctx.agentLoop.create("mock", { model: {} as never, maxSteps: 1 })).resolves.toBe(handle);
    await expect(ctx.agentLoop.resume("mock", { id: "session-1", model: {} as never, maxSteps: 1 })).resolves.toBe(handle);
    expect(created).toBe(1);
    expect(resumed).toBe(1);
    await expect(ctx.agentLoop.create("missing", { model: {} as never, maxSteps: 1 })).rejects.toThrow(/not found/);

    await disposeProvider();
    expect(ctx.agentLoop.get("mock")).toBeUndefined();
    await fiber.dispose();
  });
});
