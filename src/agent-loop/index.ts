import { streamText } from "ai";
import type { AssistantModelMessage, Tool, ToolCallPart, ToolModelMessage, ToolSet } from "ai";
import type { Context } from "cordis";

import type { Agent, AgentFactory, AgentHandle, AgentStatus } from "../agent/types.js";
import type { Session } from "../session/index.js";

export const agentLoop = {
  inject: ["agents", "sessions", "modelSurface", "systemPrompt", "tools"] as const,
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
      session.append(type, data, { surfaceOp: "append" });
      idle = runTurn(ctx, agent, session, scope).finally(() => {
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

async function runTurn(ctx: Context, agent: Agent, session: Session, scope: symbol): Promise<void> {
  const turn = session.snapshotEvents.filter((event) => event.type === "turn/start").length + 1;
  session.append("turn/start", { turn });
  try {
    for (let step = 1; step <= agent.maxSteps; step++) {
      session.append("step/start", { turn, step });
      const messages = ctx.modelSurface.deriveMessages(session);
      const prompt = await ctx.systemPrompt.snapshot(scope);
      const tools = ctx.tools.snapshot(scope);
      const result = streamText({
        model: agent.model,
        messages,
        system: prompt.system || undefined,
        tools: schemaOnly(tools),
      });
      const finalStep = await result.finalStep;

      const assistantMessage: AssistantModelMessage = {
        role: "assistant",
        content: finalStep.text,
      };
      session.append("assistant/message", { turn, step, message: assistantMessage }, { surfaceOp: "append" });

      if (finalStep.toolCalls.length) {
        for (const call of finalStep.toolCalls) {
          await executeTool(ctx, session, tools, turn, step, call);
        }
      }

      session.append("step/end", { turn, step });
      if (!finalStep.toolCalls.length) break;
    }
    session.append("turn/end", {
      turn,
      reason: { kind: "completed" },
    });
  } catch (error) {
    session.append("turn/end", {
      turn,
      reason: { kind: "error", error },
    });
    throw error;
  }
}

async function executeTool(
  ctx: Context,
  session: Session,
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
  session.append("tool/call", { turn, step, call: callPart });

  const definition = tools[call.toolName as keyof ToolSet];
  let output: unknown;
  if (definition?.execute) {
    output = await definition.execute(call.input as never, { toolCallId: call.toolCallId } as never);
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
  session.append("tool/result", { turn, step, message: toolMessage }, { surfaceOp: "append" });
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
