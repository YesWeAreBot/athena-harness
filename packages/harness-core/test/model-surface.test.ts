import type { AssistantModelMessage, ToolModelMessage } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { modelSurface } from "../src/model-surface.js";
import { sessionStore } from "../src/session/index.js";

describe("model surface", () => {
  it("derives AI SDK messages from durable session events", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modelSurface)];
    await Promise.all(fibers);

    const session = ctx.sessions.create({ id: "model-1" });
    session.append("user/message", { content: "hello" }, { surfaceOp: "append" });
    const assistantMessage: AssistantModelMessage = {
      role: "assistant",
      content: "hi",
    };
    session.append(
      "assistant/message",
      {
        turn: 1,
        step: 1,
        message: assistantMessage,
      },
      { surfaceOp: "append" },
    );
    const toolMessage: ToolModelMessage = {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call-1",
          toolName: "echo",
          output: {
            type: "text",
            value: "ok",
          },
        },
      ],
    };
    session.append(
      "tool/result",
      {
        turn: 1,
        step: 1,
        message: toolMessage,
        status: "ok",
      },
      { surfaceOp: "append" },
    );

    const messages = ctx.modelSurface.deriveMessages(session);

    expect(messages).toEqual([{ role: "user", content: "hello" }, assistantMessage, toolMessage]);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("projects custom surface events through registered user projectors", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modelSurface)];
    await Promise.all(fibers);

    ctx.modelSurface.registerUserProjector("external/message", (event) => {
      const data = event.data as { text: string };
      return `external:${data.text}`;
    });
    const session = ctx.sessions.create({ id: "model-2" });
    session.append("external/message", { text: "hello" }, { surfaceOp: "append" });

    expect(ctx.modelSurface.deriveMessages(session)).toEqual([{ role: "user", content: "external:hello" }]);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("fails when a surface event has no user projector", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modelSurface)];
    await Promise.all(fibers);

    const session = ctx.sessions.create({ id: "model-3" });
    session.append("external/message", { text: "hello" }, { surfaceOp: "append" });

    expect(() => ctx.modelSurface.deriveMessages(session)).toThrow(/No user projector registered/);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });

  it("projects context snapshots as user messages", async () => {
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(modelSurface)];
    await Promise.all(fibers);

    const session = ctx.sessions.create({ id: "model-context" });
    session.append(
      "context/snapshot",
      {
        turn: 1,
        step: 1,
        rendered: "<context>\nnow: 12:00\n</context>",
        sections: [],
      },
      { surfaceOp: "append" },
    );

    expect(ctx.modelSurface.deriveMessages(session)).toEqual([{ role: "user", content: "<context>\nnow: 12:00\n</context>" }]);

    await Promise.all(fibers.map((fiber) => fiber.dispose()));
  });
});
