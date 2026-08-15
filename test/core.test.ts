import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { sessionStore } from "../src/session/index.js";

describe("athena harness core slice", () => {
  it("composes services and creates an agent", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry), ctx.plugin(modelSurface), ctx.plugin(agentLoop)];
    await Promise.all(fibers);

    const handle = await ctx.agents.create({
      model: new MockLanguageModelV4(),
      maxSteps: 3,
    });

    expect(ctx.agents.get(handle.agent.id)).toBe(handle.agent);
    expect(ctx.sessions.get(handle.agent.id)).toBe(handle.agent.session);
    await expect(
      ctx.agents.create({
        id: handle.agent.id,
        model: new MockLanguageModelV4(),
        maxSteps: 3,
      }),
    ).rejects.toThrow(/Agent already exists/);

    handle.agent.send("user/message", { content: "hello" });
    await handle.agent.whenIdle();
    expect(handle.agent.session.snapshotEvents).toHaveLength(1);
    expect(handle.agent.session.snapshotEvents[0]?.type).toBe("user/message");

    await ctx.agents.dispose(handle.agent.id);
    expect(ctx.agents.get(handle.agent.id)).toBeUndefined();
    expect(ctx.sessions.get(handle.agent.id)).toBeUndefined();

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
