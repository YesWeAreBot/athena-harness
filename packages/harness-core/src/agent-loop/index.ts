import { streamText } from "ai";
import type { AssistantModelMessage, Tool, ToolCallPart, ToolModelMessage, ToolSet } from "ai";
import type { Context } from "cordis";

import "../agent/events.js";
import type { Agent, AgentFactory, AgentHandle, AgentStatus } from "../agent/types.js";
import type { Persistence, PersistenceSessionBinding } from "../persist/index.js";
import type { Session } from "../session/index.js";

export const agentLoop = {
  inject: ["agents", "sessions", "modelSurface", "systemPrompt", "tools"] as const,
  apply(ctx: Context) {
    const factory: AgentFactory = {
      create: async (input) => {
        const session = ctx.sessions.create({ id: input.id });
        const persist = ctx.get("persist") as Persistence | undefined;
        const binding = persist ? await persist.create(session.header) : undefined;
        return createHandle(ctx, session, input, binding);
      },
      resume: async (input) => {
        const persist = ctx.get("persist") as Persistence | undefined;
        if (persist) {
          const prepared = await persist.prepare(input.id);
          let session: Session | undefined;
          try {
            session = ctx.sessions.restore(prepared.header, prepared.events);
            await prepared.close();
            const binding = await persist.open(input.id);
            return createHandle(ctx, session, input, binding);
          } catch (error) {
            if (session) ctx.sessions.remove(session.id);
            await prepared.close();
            throw error;
          }
        }
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
  binding?: PersistenceSessionBinding,
): AgentHandle {
  let status: AgentStatus = "idle";
  let disposed = false;
  let resolveIdle: () => void = () => {};
  let idle: Promise<void> = Promise.resolve();
  let controller: AbortController | undefined;
  const scope = Symbol(session.id);

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
      ctx.emit("agent/status", { agent, status });
      appendEvent(ctx, session, binding, type, data, { surfaceOp: "append" });
      const active = new AbortController();
      controller = active;
      idle = runTurn(ctx, agent, session, scope, binding, active.signal).finally(() => {
        if (controller === active) controller = undefined;
        if (!disposed) {
          status = "idle";
          ctx.emit("agent/status", { agent, status });
        }
        resolveIdle();
      });
    },
    cancel(cause) {
      if (status !== "running") return;
      status = "stopping";
      ctx.emit("agent/status", { agent, status });
      controller?.abort(cause);
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
      ctx.emit("agent/status", { agent, status });
      controller?.abort();
      try {
        await idle;
      } catch {}
      await binding?.close();
      ctx.sessions.remove(session.id);
    },
  };
}

async function runTurn(
  ctx: Context,
  agent: Agent,
  session: Session,
  scope: symbol,
  binding: PersistenceSessionBinding | undefined,
  signal: AbortSignal,
): Promise<void> {
  const turn = session.snapshotEvents.filter((event) => event.type === "turn/start").length + 1;
  appendEvent(ctx, session, binding, "turn/start", { turn });
  let activeStep: number | undefined;
  try {
    for (let step = 1; step <= agent.maxSteps; step++) {
      activeStep = step;
      appendEvent(ctx, session, binding, "step/start", { turn, step });
      const messages = ctx.modelSurface.deriveMessages(session);
      const prompt = await ctx.systemPrompt.snapshot(scope);
      const tools = ctx.tools.snapshot(scope);
      await binding?.flush();
      const result = streamText({
        model: agent.model,
        messages,
        system: prompt.system || undefined,
        tools: schemaOnly(tools),
        abortSignal: signal,
      });
      const streamTask = (async () => {
        try {
          for await (const part of result.stream) {
            ctx.emit("agent/stream-part", { agent, part });
          }
        } catch {}
      })();
      const finalStep = await result.finalStep;
      await streamTask;

      const assistantMessage: AssistantModelMessage = {
        role: "assistant",
        content: finalStep.text,
      };
      appendEvent(ctx, session, binding, "assistant/message", { turn, step, message: assistantMessage }, { surfaceOp: "append" });
      ctx.emit("agent/output", {
        agent,
        kind: "assistant-message",
        message: assistantMessage,
      });

      if (finalStep.toolCalls.length) {
        for (const call of finalStep.toolCalls) {
          await executeTool(ctx, session, binding, tools, turn, step, call);
        }
      }

      appendEvent(ctx, session, binding, "step/end", { turn, step });
      if (!finalStep.toolCalls.length) break;
    }
    appendEvent(ctx, session, binding, "turn/end", {
      turn,
      reason: { kind: "completed" },
    });
    await binding?.flush();
  } catch (error) {
    if (signal.aborted) {
      appendEvent(ctx, session, binding, "turn/end", {
        turn,
        reason: { kind: "aborted", cause: signal.reason },
      });
      await binding?.flush();
      return;
    }
    appendEvent(ctx, session, binding, "turn/end", {
      turn,
      reason: { kind: "error", error },
    });
    ctx.emit("agent/error", {
      agent,
      turn,
      step: activeStep,
      error,
    });
    await binding?.flush();
    throw error;
  }
}

async function executeTool(
  ctx: Context,
  session: Session,
  binding: PersistenceSessionBinding | undefined,
  tools: ToolSet,
  turn: number,
  step: number,
  call: {
    toolCallId: string;
    toolName: string;
    input: unknown;
  },
): Promise<void> {
  const callPart = {
    type: "tool-call",
    toolCallId: call.toolCallId,
    toolName: call.toolName,
    args: call.input,
  } as unknown as ToolCallPart;
  appendEvent(ctx, session, binding, "tool/call", { turn, step, call: callPart });
  await binding?.flush();

  const definition = tools[call.toolName as keyof ToolSet];
  let output: unknown;
  try {
    if (definition?.execute) {
      output = await definition.execute(call.input as never, { toolCallId: call.toolCallId } as never);
    }
  } catch (error) {
    output = { error };
  }

  const toolMessage = {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: {
          type: "text",
          value: output === undefined ? "undefined" : JSON.stringify(output),
        },
      },
    ],
  } as ToolModelMessage;
  appendEvent(ctx, session, binding, "tool/result", { turn, step, message: toolMessage }, { surfaceOp: "append" });
  await binding?.flush();
}

function schemaOnly(tools: ToolSet): ToolSet {
  const result: Record<string, Tool> = {};
  for (const [name, tool] of Object.entries(tools)) {
    const clone = { ...tool } as Record<string, unknown>;
    delete clone.execute;
    result[name] = clone as Tool;
  }
  return result as ToolSet;
}

function appendEvent(
  ctx: Context,
  session: Session,
  binding: PersistenceSessionBinding | undefined,
  type: string,
  data: unknown,
  options?: { surfaceOp?: "append" },
): void {
  const event = session.append(type, data, options);
  binding?.append([event]);
}
