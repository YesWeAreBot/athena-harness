import type { LanguageModel, ModelMessage, ToolSet } from "@athena-ai/core";
import { hasToolCall, isLoopFinished, isStepCount, streamText } from "@athena-ai/core";
import type { Context, Logger } from "cordis";

import type { MessageStore } from "./message-store.js";
import { TurnQueue } from "./queue.js";
import { createWsMessage, toModelMessage, type WorkspaceStore, type WsMessage } from "./workspace-store.js";

// ─── Loop Config ─────────────────────────────────────────────────────────────

export interface LoopOptions {
  ctx: Context;
  workspace: WorkspaceStore;
  messageStore: MessageStore;
  queue: TurnQueue;
  logger?: Logger;
  maxSteps?: number;
  model: LanguageModel;
  system: string;
  compaction: string | null;
  focusSceneId: string | null;
  historyLimit?: number;
  pacing?: { charactersPerSecond: number; maxTotalDelayMs: number };
  customInnerThought?: boolean;
  /** Called when switch_focus fires to allow Attention to rebuild checkpoint. */
  onFocusSwitched?: (platform: string, channelId: string) => Promise<void>;
}

// ─── AgentLoop ───────────────────────────────────────────────────────────────

export class AgentLoop {
  private readonly logger: Logger | undefined;

  constructor(private readonly opts: LoopOptions) {
    this.logger = opts.logger ?? opts.ctx.logger("cortex-loop");
  }

  /**
   * Run one turn: collect messages, invoke the model loop, and persist results.
   * Joined messages arriving during the turn are appended via `TurnQueue.drainJoined`.
   */
  async run(trigger: WsMessage[]): Promise<void> {
    const { workspace, queue, ctx } = this.opts;
    const logger = this.logger;

    // Persist trigger messages before the turn starts
    await workspace.append(...trigger);

    await queue.submit({
      messages: trigger,
      logger,
      run: async (_initialMessages, signal) => {
        if (signal.aborted) {
          logger?.warn("loop.aborted.before");
          return;
        }

        const tools = ctx.tools.available() as ToolSet;
        const maxSteps = this.opts.maxSteps ?? 15;

        const result = streamText({
          model: this.opts.model,
          system: this.opts.system,
          messages: (await workspace.readAll()).map(toModelMessage),
          tools,
          abortSignal: signal,
          stopWhen: [isLoopFinished(), isStepCount(maxSteps), hasToolCall("wait")],
          prepareStep: async ({ stepNumber }) => {
            // Drain any messages that arrived while the model was thinking
            const joined = queue.drainJoined();
            if (joined.length > 0) {
              await workspace.append(...joined);
              logger?.debug("loop.prepareStep.joined", { stepNumber, count: joined.length });
              // Return updated messages so the model sees them
              const all = await workspace.readAll();
              return { messages: all.map(toModelMessage) };
            }
            return {};
          },
          onStepEnd: async (event) => {
            // Persist assistant and tool messages from this step
            const toPersist: WsMessage[] = [];
            const step = event;

            // Persist the assistant's text/tool-call content
            if (step.text || step.toolCalls.length > 0) {
              const parts: Array<ModelMessage["content"]> = [];
              if (step.text) {
                (parts as unknown[]).push({ type: "text", text: step.text });
              }
              for (const tc of step.toolCalls) {
                (parts as unknown[]).push({ type: "tool-call", toolCallId: tc.toolCallId, toolName: tc.toolName, args: tc.input });
              }
              toPersist.push(createWsMessage({ role: "assistant", content: parts } as unknown as ModelMessage));
            }

            // Persist tool results
            for (const tr of step.toolResults) {
              toPersist.push(
                createWsMessage({
                  role: "tool",
                  content: [{ type: "tool-result", toolCallId: tr.toolCallId, toolName: tr.toolName, output: tr.output }],
                } as unknown as ModelMessage),
              );
            }

            if (toPersist.length > 0) {
              await workspace.append(...toPersist);
            }
          },
        });

        // Consume the stream to drive execution
        for await (const _part of result.fullStream) {
          // Stream parts are consumed to drive the loop; no action needed per chunk
        }
      },
    });
  }
}
