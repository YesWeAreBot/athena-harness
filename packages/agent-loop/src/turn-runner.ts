import type { Inbox } from "@athena/agent";
import type { Projector, Session, SessionBinding, ProjectorMap } from "@athena/session";
import { streamText } from "ai";
import type { AssistantModelMessage, ToolCallPart, ToolResultPart, UserContent } from "ai";
import type { Context } from "cordis";

import type { ConcreteAgent } from "./agent-impl.js";

// Default projectors wired once — project the model-visible event types to
// ModelMessage so surface.deriveMessages() knows how to render them.
const DEFAULT_PROJECTORS: ProjectorMap = {
  global: new Map<string, Projector>([
    ["user/message", (ev) => ({ role: "user", content: (ev.data as { content: UserContent }).content })],
    ["env/observation", (ev) => ({ role: "user", content: (ev.data as { content: UserContent }).content })],
    ["assistant/message", (ev) => (ev.data as { message: AssistantModelMessage }).message],
    ["context/snapshot", (ev) => ({ role: "user", content: (ev.data as { rendered: string }).rendered })],
    [
      "tool/result",
      (ev) => {
        const d = ev.data as { result: ToolResultPart };
        return { role: "tool", content: [d.result] } as import("ai").ToolModelMessage;
      },
    ],
  ]),
  scoped: new Map(),
};

export interface RunTurnOptions {
  ctx: Context;
  agent: ConcreteAgent;
  inbox: Inbox;
  session: Session;
  binding: SessionBinding | undefined;
  signal: AbortSignal;
  lastRendered: string;
}

export async function runTurn(opts: RunTurnOptions): Promise<string> {
  const { ctx, agent, inbox, session, binding, signal } = opts;
  const { agentKey, model, maxSteps } = agent;
  let lastRendered = opts.lastRendered;

  // 1. Claim turn messages before opening the turn
  const turnContents = inbox.claimTurn();
  for (const content of turnContents) {
    session.append("user/message", { content }, { surfaceOp: "append" });
  }

  const turnEvents = session.events.filter((e) => e.type === "turn/start");
  const turn = turnEvents.length + 1;
  session.append("turn/start", { turn });

  let endReason: import("@athena/session").TurnEndReason = { kind: "completed" };

  try {
    for (let step = 1; step <= maxSteps; step++) {
      // a. Append step/start
      session.append("step/start", { turn, step });

      // b. Claim step messages
      const stepContents = inbox.claimStep();
      for (const content of stepContents) {
        session.append("env/observation", { content }, { surfaceOp: "append" });
      }

      // c. Assemble prompt; append context/snapshot only on change
      const prompt = await ctx.systemPrompt.assemble(agentKey, signal);
      if (prompt.rendered !== lastRendered) {
        session.append("context/snapshot", { turn, step, rendered: prompt.rendered }, { surfaceOp: "append" });
        lastRendered = prompt.rendered;
      }

      // d. Append request/header
      session.append("request/header", {
        turn,
        step,
        header: {
          modelId: (model as { modelId?: string }).modelId,
          provider: (model as { provider?: string }).provider,
          tools: ctx.tools.names(agentKey),
        },
      });

      // e. Flush intent to disk before model call
      await binding?.flush();

      // f. streamText with descriptor-only tools (no execute — spec A2)
      const result = await streamText({
        model,
        system: prompt.system || undefined,
        messages: session.surface.deriveMessages(new Map(session.events.map((e) => [e.seq, e])), DEFAULT_PROJECTORS, agentKey),
        tools: ctx.tools.descriptors(agentKey),
        abortSignal: signal,
      });

      const streamTask = (async () => {
        try {
          for await (const part of result.stream) {
            ctx.emit("agent/stream-part", { agentId: agent.id, part });
          }
        } catch {}
      })();
      const finalStep = await result.finalStep;
      await streamTask;

      // g. Append assistant message
      const assistantMsg: AssistantModelMessage = {
        role: "assistant",
        content: finalStep.text,
      };
      session.append("assistant/message", { turn, step, message: assistantMsg }, { surfaceOp: "append" });
      ctx.emit("agent/output", { agentId: agent.id, kind: "assistant-message", message: assistantMsg });

      // h. Execute each tool call (intent before side-effect)
      for (const call of finalStep.toolCalls) {
        const callPart: ToolCallPart = {
          type: "tool-call",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          input: call.input as Record<string, unknown>,
        };
        session.append("tool/call", { turn, step, call: callPart });
        await binding?.flush(); // intent to disk before execute

        const executors = ctx.tools.executors(agentKey);
        const toolDef = executors[call.toolName as keyof typeof executors];
        let output: unknown;
        let status: import("@athena/session").ToolResultStatus = "ok";
        try {
          if (toolDef?.execute) {
            output = await toolDef.execute(
              call.input as never,
              { toolCallId: call.toolCallId, messages: [], abortSignal: signal, context: undefined } as never,
            );
          } else {
            throw new Error(`No executor for tool: ${call.toolName}`);
          }
        } catch {
          status = "error";
          output = null;
        }

        const resultPart: ToolResultPart = {
          type: "tool-result",
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          output: { type: "text", value: output === null ? "null" : typeof output === "string" ? output : JSON.stringify(output) },
        };
        session.append("tool/result", { turn, step, result: resultPart, status }, { surfaceOp: "append" });
      }

      // i. Step end
      session.append("step/end", { turn, step });

      // j. Continue loop only if model requested tool calls
      if (finalStep.finishReason === "length") {
        endReason = { kind: "max-tokens" };
        break;
      }
      if (finalStep.toolCalls.length === 0 || finalStep.finishReason !== "tool-calls") {
        break;
      }
      if (step === maxSteps) {
        endReason = { kind: "max-steps", limit: maxSteps };
      }
    }
  } catch (err) {
    if (signal.aborted) {
      endReason = { kind: "aborted", cause: signal.reason };
    } else {
      endReason = { kind: "error", error: err };
    }
  }

  session.append("turn/end", { turn, reason: endReason });
  await binding?.flush();
  return lastRendered;
}
