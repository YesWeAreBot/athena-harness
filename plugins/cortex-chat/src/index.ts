import { Schema } from "@athena-ai/core";
import type { LanguageModel, ModelMessage } from "@athena-ai/core";
import { CortexService } from "@athena-ai/protocol";
import type { IMMessageEvent } from "@athena-ai/protocol-im";
import { Context, Service } from "cordis";
import type { Logger } from "cordis";

import { Attention } from "./attention.js";
import type { RouteResult } from "./attention.js";
import { CheckpointStore, createCheckpoint, emptyCheckpoint, type Checkpoint } from "./checkpoint.js";
import { compactWorkspace } from "./compaction.js";
import { CortexChatConfig, CortexChatConfigSchema } from "./config.js";
import { MessageStore } from "./message-store.js";
import { renderUserMessage } from "./render.js";
import { createCheckpointBuilder, createProductionRunner } from "./runner.js";
import type { CheckpointBuilder, RunnerDeps } from "./runner.js";
import { parseInitialFocus, sameScene } from "./scene.js";
import { TurnCoordinator, type TurnAdmission, type TurnInput } from "./turn-coordinator.js";

class CortexChat extends CortexService {
  public static readonly name = "cortex-chat";
  public static readonly inject = ["life", "nerve", "ai", "database", "tools"];

  public readonly config: CortexChat.Config;
  public readonly logger: Logger;
  public readonly messages: MessageStore;
  public readonly workspace: ModelMessage[];
  public readonly checkpointStore: CheckpointStore;
  public readonly attention: Attention;
  public readonly coordinator: TurnCoordinator;
  private checkpoint: Checkpoint;
  private readonly checkpointBuilder: CheckpointBuilder;
  private readonly runnerDeps: RunnerDeps;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private checkpointLoadFailed = false;
  private readonly readyGate = Promise.withResolvers<void>();

  /**
   * Resolves once the checkpoint is restored and inbound routing is live.
   *
   * Restoration is asynchronous and deliberately not awaited by `Service.init`
   * (a Cortex must not block its Life's activation on disk I/O), so callers that
   * need to know when this Cortex started accepting events await this instead.
   */
  public readonly ready: Promise<void> = this.readyGate.promise;

  constructor(ctx: Context, config: CortexChat.Config) {
    super(ctx, "cortex");

    this.config = config;
    this.logger = ctx.logger("cortex-chat");
    this.messages = new MessageStore(ctx);
    this.workspace = [];
    this.checkpointStore = new CheckpointStore(ctx);
    this.checkpoint = emptyCheckpoint();

    const initialFocus = parseInitialFocus(config.initialFocus ?? "");
    this.attention = new Attention({
      store: this.messages,
      initialFocus,
      awarenessHistoryLimit: config.focusHistoryLimit,
      onColdStart: () => this.persistColdStartFrame(),
    });

    this.coordinator = new TurnCoordinator({
      workspace: this.workspace,
      aggregateWindow: config.aggregateWindow ?? 0,
      compaction: {
        summarize: (request) => compactWorkspace({ ...request, model: this.compactionModel() }),
        buildCheckpoint: (compaction, frame) => this.checkpointBuilder(compaction, frame),
        checkpointStore: this.checkpointStore,
        getCheckpoint: () => this.checkpoint,
        setCheckpoint: (next) => {
          this.checkpoint = next;
        },
        needsRebuild: () => {
          const snapshot = this.attention.snapshot();
          if (!sameScene(snapshot.frameFocus, snapshot.logicalFocus)) return true;
          return this.checkpoint.focus !== null && !sameScene(this.checkpoint.focus, snapshot.logicalFocus);
        },
        logicalFocus: () => this.attention.snapshot().logicalFocus,
        readFocusHistory: async (focus) => (await this.messages.readScene(focus, { limit: config.focusHistoryLimit })).map(renderUserMessage),
        promoteFocus: () => {
          this.attention.promoteFocus();
        },
        pruneOptions: {
          toolOutputMaxChars: config.toolOutputMaxChars,
          toolOutputHeadChars: config.toolOutputHeadChars,
          toolOutputTailChars: config.toolOutputTailChars,
        },
        thresholdTokens: config.compactThreshold,
        logger: this.logger,
      },
    });
    this.runnerDeps = {
      ctx,
      workspace: this.workspace,
      messages: this.messages,
      attention: this.attention,
      coordinator: this.coordinator,
      checkpointStore: this.checkpointStore,
      getCheckpoint: () => this.checkpoint,
      setCheckpoint: (next) => {
        this.checkpoint = next;
      },
      config,
      logger: this.logger,
    };
    this.checkpointBuilder = createCheckpointBuilder();
  }

  *[Service.init]() {
    yield* super[Service.init]();
    void this.start().then(
      () => this.readyGate.resolve(),
      (error: unknown) => {
        this.logger.warn("cortex-chat.initialize.failed", { error });
        this.readyGate.reject(error);
      },
    );
    // `ready` is optional for callers; the warn above is the reported failure.
    void this.ready.catch(() => {});
    yield async () => {
      this.disposed = true;
      this.clearIdleTimer();
      await this.coordinator.stop();
    };
  }

  private async start(): Promise<void> {
    await this.initialize();
    if (this.disposed) return;

    this.coordinator.bindRunner(createProductionRunner(this.runnerDeps));
    this.messages.attach();
    this.ctx.on("message-created", (event: IMMessageEvent) => {
      void this.onMessage(event).catch((error) => {
        this.logger.warn("cortex-chat.message.failed", { error });
      });
    });
    this.scheduleIdleCompaction();
  }

  private async initialize(): Promise<void> {
    try {
      const saved = await this.checkpointStore.load();
      if (saved) {
        this.checkpoint = saved;
        this.attention.restoreFocus(saved.focus);
        return;
      }
      await this.persistColdStartFrame();
    } catch (error) {
      this.checkpointLoadFailed = true;
      this.logger.warn("cortex-chat.loadCheckpoint.failed", { error });
    }
  }

  private async persistColdStartFrame(): Promise<void> {
    if (this.checkpointLoadFailed) return;
    const focus = this.attention.snapshot().frameFocus;
    if (this.checkpoint.focus !== null || focus === null) return;
    const next = createCheckpoint({ focus, history: [], lastFocusHistory: [], compaction: this.checkpoint.compaction });
    await this.checkpointStore.save(next);
    this.checkpoint = next;
  }

  private async onMessage(event: IMMessageEvent): Promise<void> {
    if (event.selfId === event.userId) return;

    const stored = await this.messages.storeEvent(event);
    const message = renderUserMessage(stored);
    const routed: RouteResult = await this.attention.route({ event, stored, message });
    if (routed.kind === "ignore") return;

    if (routed.kind === "background") {
      this.coordinator.appendWorkspaceDelta(routed.messages);
      return;
    }

    this.clearIdleTimer();
    await this.fireTurn(routed.messages, routed.kind === "awareness" ? "awareness" : "message");
  }

  private async fireTurn(messages: readonly ModelMessage[], cause: TurnInput["cause"]): Promise<void> {
    let admission: TurnAdmission;
    try {
      admission = this.coordinator.submit({ messages, cause });
    } catch (error) {
      this.logger.warn("cortex-chat.submit.failed", { error });
      return;
    }

    // Post-turn handling never blocks the caller: a turn's threshold compaction
    // is applied by the coordinator itself, so this only schedules idle
    // compaction and reports an unsuccessful turn.
    void admission.done
      .then((result) => {
        if (result.status === "failed") this.logger.warn("cortex-chat.turn.failed", { turnId: admission.turnId, error: result.error });
        if (result.status === "aborted") this.logger.warn("cortex-chat.turn.aborted", { turnId: admission.turnId, reason: result.reason });
        this.scheduleIdleCompaction();
      })
      .catch((error) => {
        this.logger.warn("cortex-chat.turn.done.rejected", { turnId: admission.turnId, error });
      });
  }

  /** The compaction model, falling back to the main model and then to the default. */
  private compactionModel(): LanguageModel {
    const configured = this.config.compactModel || this.config.model;
    return this.ctx.ai.language(configured === "" ? undefined : configured);
  }

  /**
   * Idle compaction is a coordinator request like any other, so the timer can
   * never start a transition next to an active turn.
   */
  private scheduleIdleCompaction(): void {
    if (this.config.idleTimeout <= 0) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null;
      void this.coordinator.requestCompaction().catch((error: unknown) => {
        this.logger.warn("cortex-chat.idleCompaction.failed", { error });
      });
    }, this.config.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

namespace CortexChat {
  export type Config = CortexChatConfig;
  export const Config: Schema<Config> = CortexChatConfigSchema as Schema<Config>;
}

export default CortexChat;
