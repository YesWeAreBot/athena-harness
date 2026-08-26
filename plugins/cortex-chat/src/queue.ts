import type { Context, Logger } from "cordis";

import type { WsMessage } from "./workspace-store.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface TurnInput {
  messages: WsMessage[];
  run: (input: WsMessage[], signal: AbortSignal) => Promise<void>;
  logger?: Logger;
}

export interface TurnQueueOptions {
  logger?: Logger;
}

export type TurnState = "idle" | "running";

// ─── TurnQueue ───────────────────────────────────────────────────────────────

export class TurnQueue {
  private tail: Promise<void> = Promise.resolve();
  private activeSignal: AbortController | null = null;
  private activeTurnId: string | null = null;
  private pending: WsMessage[] = [];
  private readonly logger: Logger | undefined;

  constructor(
    private readonly ctx: Context,
    options: TurnQueueOptions = {},
  ) {
    this.logger = options.logger ?? ctx.logger("turn-queue");
  }

  get state(): TurnState {
    return this.activeTurnId !== null ? "running" : "idle";
  }

  isActive(): boolean {
    return this.state === "running";
  }

  getActiveTurnId(): string | null {
    return this.activeTurnId;
  }

  /** Messages that arrived while a turn was running — drained in prepareStep. */
  drainJoined(): WsMessage[] {
    if (this.pending.length === 0) return [];
    const out = [...this.pending];
    this.pending.length = 0;
    return out;
  }

  /** Enqueue a turn. Returns when the turn completes (or is aborted). */
  async submit(input: TurnInput): Promise<void> {
    // If a turn is currently running, stash the messages for join and return.
    // The join consumer (loop.ts prepareStep) will drain them as a delta.
    if (this.isActive()) {
      this.pending.push(...input.messages);
      this.logger?.debug("turn.join", { count: input.messages.length });
      return;
    }

    const runPromise = this.schedule(async () => {
      const ac = new AbortController();
      this.activeSignal = ac;
      // Simple turnId — not exposed externally yet
      this.activeTurnId = `turn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        await input.run(input.messages, ac.signal);
      } catch (error) {
        // SAFETY: narrowing caught unknown to Error for .name check
        if ((error as Error)?.name === "AbortError") {
          this.logger?.warn("turn.aborted", { turnId: this.activeTurnId });
        } else {
          this.logger?.warn("turn.failed", { error });
        }
      } finally {
        this.activeTurnId = null;
        this.activeSignal = null;
      }
    });

    // If submission received new messages during this turn via submit(join),
    // they are already in pending. Instead of needing the caller to poll,
    // the loop itself drains them during prepareStep — so no extra handling here.
    // However if submit was called while running, it already returned early
    // without scheduling; the running turn's prepareStep will pick it up.

    return runPromise;
  }

  /** Abort the currently running turn, if any. */
  interrupt(reason = "interrupt"): void {
    if (this.activeSignal) {
      this.activeSignal.abort(new Error(reason));
      this.logger?.warn("turn.interrupted", { reason });
    }
  }

  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}
