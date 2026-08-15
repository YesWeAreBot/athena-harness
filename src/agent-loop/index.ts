import type { Context } from "cordis";

import type { Agent, AgentFactory, AgentHandle, AgentStatus } from "../agent/types.js";
import type { Session } from "../session/index.js";

export const agentLoop = {
  inject: ["agents", "sessions", "modelSurface"] as const,
  apply(ctx: Context) {
    const factory: AgentFactory = {
      create: (input) => {
        const session = ctx.sessions.create({ id: input.id });
        return createHandle(ctx, session, input);
      },
      resume: (input) => {
        const session = ctx.sessions.get(input.id);
        if (!session) {
          throw new Error(`Session not found: ${input.id}`);
        }
        return createHandle(ctx, session, input);
      },
    };
    return ctx.agents.setFactory(factory);
  },
};

function createHandle(
  ctx: Context,
  session: Session,
  input: {
    model: Agent["model"];
    maxSteps: number;
  },
): AgentHandle {
  let status: AgentStatus = "idle";
  let disposed = false;
  let resolveIdle: () => void = () => {};
  let idle: Promise<void> = Promise.resolve();

  const agent: Agent = {
    id: session.id,
    session,
    model: input.model,
    maxSteps: input.maxSteps,
    get status() {
      return status;
    },
    send(type, data) {
      if (disposed) throw new Error("Agent is disposed");
      if (status !== "idle") throw new Error("Agent is busy");
      if (type !== "user/message" && !ctx.modelSurface.hasUserProjector(type)) {
        throw new Error(`No user projector registered for event: ${type}`);
      }
      status = "running";
      session.append(type, data, { surfaceOp: "append" });
      idle = new Promise<void>((resolve) => {
        resolveIdle = resolve;
      });
      queueMicrotask(() => {
        status = "idle";
        resolveIdle();
      });
    },
    cancel() {
      if (status !== "running") return;
      status = "idle";
      resolveIdle();
    },
    whenIdle() {
      return idle;
    },
  };

  return {
    agent,
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      status = "disposed";
      resolveIdle();
      ctx.sessions.remove(session.id);
    },
  };
}
