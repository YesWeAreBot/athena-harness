import { generateId } from "@athena-ai/core";
import type { LanguageModelUsage, ModelMessage } from "@athena-ai/core";
import type { Logger } from "cordis";

import type { Checkpoint, Frame } from "./checkpoint.js";
import { estimateTokens } from "./compaction.js";
import type { CompactionResult, SummarizeRequest } from "./compaction.js";
import { prune } from "./prune.js";
import type { PruneOptions } from "./prune.js";
import type { SceneAddress } from "./scene.js";

export interface TurnInput {
  readonly messages: readonly ModelMessage[];
  readonly cause: "message" | "awareness" | "manual" | "idle";
}

export type TurnAdmission =
  | { readonly kind: "started"; readonly turnId: string; readonly done: Promise<TurnResult> }
  | { readonly kind: "joined"; readonly turnId: string; readonly done: Promise<TurnResult> }
  | { readonly kind: "queued"; readonly turnId: string; readonly done: Promise<TurnResult> };

export type TurnResult =
  | { readonly status: "completed"; readonly turnId: string; readonly finishReason: string; readonly usage?: LanguageModelUsage; readonly delivered: boolean }
  | { readonly status: "failed"; readonly turnId: string; readonly error: unknown }
  | { readonly status: "aborted"; readonly turnId: string; readonly reason: unknown };

export type RunnerFn = (input: TurnInput, turnId: string, signal: AbortSignal) => Promise<TurnResult>;

/**
 * Collaborators of the checkpoint transition. The coordinator decides when a
 * transition runs; the runner owns the in-memory workspace and frame projection.
 */
export interface CompactionServices {
  readonly summarize: (request: SummarizeRequest) => Promise<CompactionResult>;
  readonly buildCheckpoint: (compaction: string | null, frame: Frame) => Promise<Checkpoint>;
  readonly checkpointStore: { save(checkpoint: Checkpoint): Promise<void> };
  readonly getCheckpoint: () => Checkpoint;
  readonly setCheckpoint: (checkpoint: Checkpoint) => void;
  readonly needsRebuild: () => boolean;
  readonly logicalFocus: () => SceneAddress | null;
  readonly readFocusHistory: (focus: SceneAddress) => Promise<readonly ModelMessage[]>;
  readonly promoteFocus: () => void;
  readonly pruneOptions?: PruneOptions;
  /** Estimated workspace tokens that trigger a compaction once a turn ends. */
  readonly thresholdTokens: number;
  readonly logger?: Logger;
}

export interface TurnCoordinatorOptions {
  /**
   * Turn executor. The production runner needs the coordinator it belongs to
   * for joined-message admission, so it may be supplied later through bindRunner.
   */
  readonly runner?: RunnerFn | { readonly run: RunnerFn };
  readonly workspace?: ModelMessage[];
  readonly compaction?: CompactionServices;
  readonly aggregateWindow?: number;
  readonly config?: { readonly aggregateWindow?: number };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  promise.catch(() => {});
  return { promise, resolve, reject };
}

interface ActiveTurn {
  readonly turnId: string;
  readonly controller: AbortController;
  readonly deferred: Deferred<TurnResult>;
  readonly input: TurnInput;
  finalizing: boolean;
}

interface QueuedTurn {
  readonly turnId: string;
  readonly input: TurnInput;
  readonly deferred: Deferred<TurnResult>;
}

interface AggregateBuffer {
  readonly turnId: string;
  readonly deferred: Deferred<TurnResult>;
  readonly inputs: TurnInput[];
  timer: ReturnType<typeof setTimeout> | null;
}

/** Validated compaction collaborators, resolved once per transition. */
interface CompactionContext {
  readonly services: CompactionServices;
  readonly workspace: ModelMessage[];
}

export class TurnCoordinator {
  private runnerFn: RunnerFn | null;
  private readonly aggregateWindow: number;
  private readonly workspace: ModelMessage[] | null;
  private readonly compaction: CompactionServices | null;

  private stopped = false;
  private current: ActiveTurn | null = null;
  private aggregate: AggregateBuffer | null = null;
  private readonly queued: QueuedTurn[] = [];
  private readonly joinedBuffer: ModelMessage[] = [];

  /** In-flight compaction, so concurrent requests join it instead of racing. */
  private compacting: Promise<void> | null = null;
  /** A request that arrived while a turn was active; handled after finalization. */
  private pendingCompaction: Deferred<void> | null = null;
  /** Every background task (turn body, compaction) so disposal can await them. */
  private backgroundTail: Promise<void> = Promise.resolve();

  constructor(options: TurnCoordinatorOptions) {
    const candidate = options.runner;
    if (candidate === undefined) {
      this.runnerFn = null;
    } else if (typeof candidate === "function") {
      this.runnerFn = candidate;
    } else if (typeof candidate.run === "function") {
      this.runnerFn = candidate.run.bind(candidate);
    } else {
      throw new Error("TurnCoordinator requires runner function or object with run method");
    }
    const fromDirect = options.aggregateWindow;
    const fromConfig = options.config?.aggregateWindow;
    this.aggregateWindow = fromDirect ?? fromConfig ?? 0;
    this.workspace = options.workspace ?? null;
    this.compaction = options.compaction ?? null;
    if (this.compaction && !this.workspace) {
      throw new Error("TurnCoordinator compaction requires an in-memory workspace");
    }
  }

  /** Attach the turn executor once its own dependencies exist. */
  bindRunner(runner: RunnerFn): void {
    if (this.runnerFn) throw new Error("TurnCoordinator runner is already bound");
    this.runnerFn = runner;
  }
  private requireRunner(): RunnerFn {
    if (!this.runnerFn) throw new Error("TurnCoordinator has no runner bound");
    return this.runnerFn;
  }
  submit(input: TurnInput): TurnAdmission {
    if (this.stopped) {
      throw new Error("TurnCoordinator is stopped");
    }
    this.requireRunner();
    if (this.compacting) {
      const turnId = generateId();
      const deferred = createDeferred<TurnResult>();
      this.queued.push({ turnId, input, deferred });
      return { kind: "queued", turnId, done: deferred.promise };
    }

    if (this.aggregate) {
      this.aggregate.inputs.push(input);
      return { kind: "queued", turnId: this.aggregate.turnId, done: this.aggregate.deferred.promise };
    }

    if (this.current) {
      if (this.current.finalizing) {
        const turnId = generateId();
        const deferred = createDeferred<TurnResult>();
        this.queued.push({ turnId, input, deferred });
        return { kind: "queued", turnId, done: deferred.promise };
      }
      this.joinedBuffer.push(...input.messages);
      return { kind: "joined", turnId: this.current.turnId, done: this.current.deferred.promise };
    }

    if (this.queued.length > 0) {
      const turnId = generateId();
      const deferred = createDeferred<TurnResult>();
      this.queued.push({ turnId, input, deferred });
      return { kind: "queued", turnId, done: deferred.promise };
    }

    if (this.aggregateWindow > 0) {
      const turnId = generateId();
      const deferred = createDeferred<TurnResult>();
      const buffer: AggregateBuffer = {
        turnId,
        deferred,
        inputs: [input],
        timer: setTimeout(() => {
          void this.flushAggregate();
        }, this.aggregateWindow),
      };
      this.aggregate = buffer;
      return { kind: "queued", turnId, done: deferred.promise };
    }

    return this.launchTurn(input);
  }

  private launchTurn(input: TurnInput, preserved?: { turnId: string; deferred: Deferred<TurnResult> }): TurnAdmission {
    const turnId = preserved?.turnId ?? generateId();
    const deferred = preserved?.deferred ?? createDeferred<TurnResult>();
    const controller = new AbortController();
    const turn: ActiveTurn = {
      turnId,
      controller,
      deferred,
      input,
      finalizing: false,
    };
    this.current = turn;

    const settled = (async () => {
      try {
        const result = await this.requireRunner()(turn.input, turn.turnId, turn.controller.signal);
        if (turn.controller.signal.aborted && result.status !== "aborted") {
          turn.deferred.resolve({ status: "aborted", turnId: turn.turnId, reason: turn.controller.signal.reason });
        } else {
          turn.deferred.resolve(result);
        }
      } catch (error) {
        if (turn.controller.signal.aborted) {
          const reason = turn.controller.signal.reason ?? error;
          turn.deferred.resolve({ status: "aborted", turnId: turn.turnId, reason });
        } else {
          turn.deferred.resolve({ status: "failed", turnId: turn.turnId, error });
        }
      }

      this.current = null;
      if (this.stopped) return;
      if (this.queued.length > 0) {
        const next = this.queued.shift()!;
        this.launchTurn(next.input, { turnId: next.turnId, deferred: next.deferred });
        return;
      }
      await this.drainCompaction();
    })();
    this.backgroundTail = settled;

    if (preserved) {
      return { kind: "queued", turnId, done: deferred.promise };
    }
    return { kind: "started", turnId, done: deferred.promise };
  }

  private async flushAggregate(): Promise<void> {
    const agg = this.aggregate;
    if (!agg) return;
    this.aggregate = null;
    if (agg.timer) {
      clearTimeout(agg.timer);
    }
    if (agg.inputs.length === 0) {
      agg.deferred.reject(new Error("Empty aggregate"));
      return;
    }
    const combinedMessages: ModelMessage[] = [];
    for (const item of agg.inputs) {
      combinedMessages.push(...item.messages);
    }
    const cause = agg.inputs[0]?.cause ?? "message";
    const combined: TurnInput = { messages: combinedMessages, cause };
    this.launchTurn(combined, { turnId: agg.turnId, deferred: agg.deferred });
  }
  appendWorkspaceDelta(messages: readonly ModelMessage[]): void {
    if (messages.length === 0) return;
    if (this.current) {
      this.joinedBuffer.push(...messages);
      return;
    }
    if (!this.workspace) throw new Error("TurnCoordinator has no in-memory workspace");
    this.workspace.push(...messages);
  }

  drainJoined(): ModelMessage[] {
    if (this.joinedBuffer.length === 0) return [];
    const out = [...this.joinedBuffer];
    this.joinedBuffer.length = 0;
    return out;
  }

  active(): { readonly turnId: string } | null {
    if (!this.current) return null;
    return { turnId: this.current.turnId };
  }

  /**
   * Ask for a checkpoint transition.
   *
   * Compaction never runs next to a turn or to another compaction: a request
   * arriving mid-turn is coalesced and handled once the turn finalizes, and
   * concurrent requests join the run already in flight. The returned promise
   * carries the original failure so a caller can retry at this boundary.
   */
  async requestCompaction(): Promise<void> {
    if (this.stopped) throw new Error("TurnCoordinator is stopped");
    if (!this.compaction) return;
    if (this.current || this.aggregate || this.queued.length > 0) {
      this.pendingCompaction ??= createDeferred<void>();
      return this.pendingCompaction.promise;
    }
    return this.startCompaction();
  }

  /** Resolves once no turn body and no compaction is still running. */
  async flush(): Promise<void> {
    let previous: Promise<void> | null = null;
    while (this.backgroundTail !== previous) {
      previous = this.backgroundTail;
      await previous.catch(() => {});
    }
  }
  private compactionContext(): CompactionContext | null {
    const services = this.compaction;
    const workspace = this.workspace;
    if (!services || !workspace) return null;
    return { services, workspace };
  }

  private startCompaction(): Promise<void> {
    const existing = this.compacting;
    if (existing) return existing;
    const run = this.runCompaction().finally(() => {
      this.compacting = null;
      if (!this.stopped && !this.current && this.queued.length > 0) {
        const next = this.queued.shift()!;
        this.launchTurn(next.input, { turnId: next.turnId, deferred: next.deferred });
      }
    });
    this.compacting = run;
    // Tracked even when the caller drops the promise, so disposal can await it.
    this.backgroundTail = run.catch(() => {});
    return run;
  }

  /** After a turn: honour a coalesced request, otherwise apply the threshold. */
  private async drainCompaction(): Promise<void> {
    const pending = this.pendingCompaction;
    if (pending) {
      this.pendingCompaction = null;
      try {
        await this.startCompaction();
        pending.resolve();
      } catch (error) {
        pending.reject(error);
      }
      return;
    }

    const context = this.compactionContext();
    if (!context) return;
    if (!context.services.needsRebuild() && estimateTokens(context.workspace) < context.services.thresholdTokens) return;
    try {
      await this.startCompaction();
    } catch (error) {
      context.services.logger?.warn("compaction after turn failed: %o", error);
    }
  }

  private async runCompaction(): Promise<void> {
    const context = this.compactionContext();
    if (!context) return;
    const { services, workspace } = context;
    const focusChanged = services.needsRebuild();
    if (!focusChanged && workspace.length === 0) return;

    const covered = [...workspace];
    const previous = services.getCheckpoint();
    services.promoteFocus();
    const pruned = prune(covered, services.pruneOptions);
    const focus = services.logicalFocus();
    const frame: Frame = {
      focus,
      history: focusChanged && focus ? await services.readFocusHistory(focus) : pruned,
      lastFocusHistory: focusChanged ? pruned : [],
    };
    const result = await services.summarize({
      history: previous.history,
      lastFocusHistory: previous.lastFocusHistory,
      previousCompaction: previous.compaction,
    });
    const checkpoint = await services.buildCheckpoint(result.compaction.length > 0 ? result.compaction : previous.compaction, frame);
    await services.checkpointStore.save(checkpoint);
    services.setCheckpoint(checkpoint);
    workspace.splice(0, covered.length);
  }

  emitFinalStep(turnId: string): void {
    if (this.current && this.current.turnId === turnId) {
      this.current.finalizing = true;
    }
  }

  async interrupt(reason: unknown): Promise<void> {
    if (!this.current) return;
    try {
      this.current.controller.abort(reason);
    } catch {}
    try {
      await this.current.deferred.promise;
    } catch {}
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.aggregate?.timer) {
      clearTimeout(this.aggregate.timer);
      this.aggregate.timer = null;
    }
    const pending = this.pendingCompaction;
    if (pending) {
      this.pendingCompaction = null;
      pending.reject(new Error("TurnCoordinator is stopped"));
    }
    if (this.current) {
      try {
        this.current.controller.abort(new Error("TurnCoordinator is stopped"));
      } catch {}
      try {
        await this.current.deferred.promise;
      } catch {}
    }
    // No turn body or compaction may outlive disposal.
    await this.flush();
  }

  /**
   * Messages this coordinator still owns and has not handed to a runner:
   * the joined buffer, the aggregate window, the queue, and the active turn.
   *
   * `stop()` aborts the active turn without draining the queue, so this is how a
   * caller can tell that no submitted message was dropped on the way out.
   */
  pendingMessages(): readonly ModelMessage[] {
    const out: ModelMessage[] = [...this.joinedBuffer];
    for (const entry of this.queued) {
      out.push(...entry.input.messages);
    }
    for (const item of this.aggregate?.inputs ?? []) {
      out.push(...item.messages);
    }
    if (this.current) {
      out.push(...this.current.input.messages);
    }
    return out;
  }
}
