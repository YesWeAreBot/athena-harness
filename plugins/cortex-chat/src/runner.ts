import { generateText } from "@athena-ai/core";
import type { LanguageModelUsage, ModelMessage, StepResult, SystemModelMessage, ToolSet } from "@athena-ai/core";
import type { Context, Logger } from "cordis";

import type { Attention } from "./attention.js";
import { createCheckpoint } from "./checkpoint.js";
import type { Checkpoint, CheckpointStore, Frame } from "./checkpoint.js";
import type { CortexChatConfig } from "./config.js";
import type { MessageStore } from "./message-store.js";
import { buildPromptSnapshot } from "./prompt.js";
import type { SceneAddress } from "./scene.js";
import { assembleTools } from "./tools.js";
import type { CoreToolRuntime } from "./tools.js";
import type { RunnerFn, TurnCoordinator } from "./turn-coordinator.js";

// ─── Deps ───────────────────────────────────────────────────────────────────

export interface RunnerDeps {
  readonly ctx: Context;
  readonly workspace: ModelMessage[];
  readonly messages: MessageStore;
  readonly attention: Attention;
  readonly coordinator: TurnCoordinator;
  readonly checkpointStore: CheckpointStore;
  readonly getCheckpoint: () => Checkpoint;
  readonly setCheckpoint: (checkpoint: Checkpoint) => void;
  readonly config: CortexChatConfig;
  readonly logger: Logger;
}

// ─── Step decisions ─────────────────────────────────────────────────────────

type ChatStep = StepResult<ToolSet>;
type StepToolCall = ChatStep["toolCalls"][number];
type StepToolResult = ChatStep["toolResults"][number];

/** `send_message` reports platform delivery in its structured output. */
function isDeliveredSend(result: StepToolResult): boolean {
  if (result.toolName !== "send_message") return false;
  const output: unknown = result.output;
  return typeof output === "object" && output !== null && "ok" in output && output.ok === true;
}

/** The model decides whether a send keeps the turn open; its input is untyped JSON. */
function isContinuingSend(call: StepToolCall): boolean {
  const input: unknown = call.input;
  return typeof input === "object" && input !== null && "continue" in input && input.continue === true;
}

/** `wait` and a non-continuing `send_message` end the turn. */
function isTerminalStep(step: Pick<ChatStep, "toolCalls">): boolean {
  return step.toolCalls.some((call) => call.toolName === "wait" || (call.toolName === "send_message" && !isContinuingSend(call)));
}

function formatScene(scene: SceneAddress | null): string {
  return scene ? `${scene.bodySid}/${scene.channelId}` : "none";
}

// ─── Checkpoint transition ──────────────────────────────────────────────────

export type CheckpointBuilder = (compaction: string | null, frame: Frame) => Promise<Checkpoint>;

/** Build a durable checkpoint from an already-selected structured frame. */
export function createCheckpointBuilder(): CheckpointBuilder {
  return async (compaction, frame) => createCheckpoint({ ...frame, compaction });
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createProductionRunner(deps: RunnerDeps): RunnerFn {
  const { ctx, workspace, messages, attention, coordinator, getCheckpoint, config, logger } = deps;

  return async (input, turnId, signal) => {
    if (signal.aborted) return { status: "aborted", turnId, reason: signal.reason };

    const checkpoint = getCheckpoint();
    const prompt = buildPromptSnapshot({ persona: ctx.life.persona, compaction: checkpoint.compaction }, checkpoint);

    // The request list contains the frozen stable/frame prefix followed by the
    // shared in-memory workspace. Every entry is an original ModelMessage.
    const requestMessages: ModelMessage[] = [...prompt.stableMessages, ...prompt.frameMessages, ...workspace];
    workspace.push(...input.messages);
    requestMessages.push(...input.messages);

    const pendingDeltas: ModelMessage[] = [];
    const runtime: CoreToolRuntime = {
      logicalFocus: () => attention.snapshot().logicalFocus,
      switchFocus: async (target, reason) => {
        const transition = attention.switchFocus(target);
        const focusChange: SystemModelMessage = {
          role: "system",
          content: `<focusChange from="${formatScene(transition.from)}" to="${formatScene(target)}">${reason}</focusChange>`,
        };
        pendingDeltas.push(focusChange);
        return { ok: true, focus: target };
      },
      peekChannel: async (target, limit) => {
        const history = await messages.readScene(target, { limit });
        return {
          scene: target,
          messages: history.map((entry) => ({ userId: entry.userId, content: entry.content, timestamp: entry.timestamp })),
        };
      },
      appendWorkspaceDelta: (deltas) => pendingDeltas.push(...deltas),
    };

    const tools = assembleTools(ctx, runtime, config.pacing, config.customInnerThought);
    const model = ctx.ai.language(config.model === "" ? undefined : config.model);

    let delivered = false;
    let finishReason = "unknown";
    let usage: LanguageModelUsage | undefined;
    let steps = 0;

    try {
      while (steps < config.maxSteps) {
        if (signal.aborted) return { status: "aborted", turnId, reason: signal.reason };

        const joined = coordinator.drainJoined();
        if (joined.length > 0) {
          logger.debug("turn %s joins %d message(s) at a step boundary", turnId, joined.length);
          workspace.push(...joined);
          requestMessages.push(...joined);
        }

        const result = await generateText({
          model,
          allowSystemInMessages: true,
          messages: requestMessages,
          tools,
          abortSignal: signal,
        });

        workspace.push(...result.response.messages);
        requestMessages.push(...result.response.messages);
        if (pendingDeltas.length > 0) {
          workspace.push(...pendingDeltas);
          requestMessages.push(...pendingDeltas);
          pendingDeltas.length = 0;
        }

        delivered ||= result.toolResults.some(isDeliveredSend);
        finishReason = result.finishReason;
        usage = result.usage;
        steps += 1;
        if (result.toolCalls.length === 0 || isTerminalStep(result)) break;
      }

      return { status: "completed", turnId, finishReason, usage, delivered };
    } catch (error) {
      if (signal.aborted) return { status: "aborted", turnId, reason: signal.reason };
      logger.warn("turn %s failed: %o", turnId, error);
      return { status: "failed", turnId, error };
    } finally {
      coordinator.emitFinalStep(turnId);
    }
  };
}
