import { SessionRegistry } from "@athena/session";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { ModePipelineRegistry } from "../src/mode-pipeline/index.js";
import type { ModePipeline } from "../src/mode-pipeline/types.js";

describe("mode pipeline", () => {
  it("registers and runs a six-axis pipeline", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(ModePipelineRegistry);
    await fiber;
    const sessionFiber = ctx.plugin(SessionRegistry);
    await sessionFiber;

    const session = ctx.sessions.create({ id: "pipeline-session" });
    const life = {
      id: "life",
      session,
      disposed: false,
      activeModeId: "echo",
      bodyIds: ["manual"],
    };
    const pipeline: ModePipeline = {
      id: "echo",
      trigger: { kinds: ["event"], eventInterests: [{ kind: "message-created" }] },
      context: {
        id: "echo-context",
        build: async () => ({ messages: [], system: "echo" }),
      },
      execution: {
        id: "echo-exec",
        kind: "structured-output",
        execute: async () => ({ kind: "text", output: "hello" }),
      },
      interpret: {
        id: "echo-interpret",
        interpret: async () => ({
          effects: [
            {
              type: "session-append",
              eventType: "echo/output",
              data: { text: "hello" },
            },
          ],
        }),
      },
      effects: [
        {
          id: "session-effect",
          handle: async (action) => {
            if (action.type !== "session-append") return;
            session.append(action.eventType, action.data as { text: string });
          },
        },
      ],
    };

    ctx.modePipelines.register(pipeline);
    const result = await ctx.modePipelines.run("echo", { session, life });

    expect(result.effects).toHaveLength(1);
    expect(session.events.at(-1)?.type).toBe("echo/output");
    expect(ctx.modePipelines.list().map((item) => item.id)).toEqual(["echo"]);

    await sessionFiber.dispose();
    await fiber.dispose();
  });
});
