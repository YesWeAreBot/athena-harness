import type { UserContent } from "ai";
import type { Context } from "cordis";
import type { Session, SessionBinding } from "@athena/session";
import type { Agent, AgentStatus } from "@athena/agent";
import { Inbox } from "@athena/agent";
import { runTurn } from "./turn-runner.js";

export class ConcreteAgent implements Agent {
  readonly id:       string;
  readonly session:  Session;
  readonly model:    import("ai").LanguageModel;
  readonly maxSteps: number;
  readonly agentKey: symbol;

  private _status: AgentStatus = "idle";
  private _inbox  = new Inbox();
  private _ctrl:  AbortController | undefined;
  private _idle:  Promise<void>  = Promise.resolve();
  private _resolveIdle: (() => void) | undefined;
  private _ctx:   Context;
  private _binding: SessionBinding | undefined;
  private _lastRendered = "";

  constructor(opts: {
    id:       string;
    session:  Session;
    model:    import("ai").LanguageModel;
    maxSteps: number;
    ctx:      Context;
    binding?: SessionBinding;
  }) {
    this.id       = opts.id;
    this.session  = opts.session;
    this.model    = opts.model;
    this.maxSteps = opts.maxSteps;
    this.agentKey = Symbol(opts.id);
    this._ctx     = opts.ctx;
    this._binding = opts.binding;
  }

  get status(): AgentStatus { return this._status; }

  followup(content: UserContent): void {
    this._assertNotDisposed();
    this._inbox.pushTurn(content);
    this._wake();
  }

  steer(content: UserContent): void {
    this._assertNotDisposed();
    this._inbox.pushStep(content);
    this._wake();
  }

  inject(content: UserContent): void {
    this._assertNotDisposed();
    this._inbox.pushStep(content);
    // no wake — passive accumulation
  }

  cancel(cause?: unknown): void {
    if (this._status === "running") {
      this._status = "stopping";
      this._ctrl?.abort(cause);
    }
  }

  whenIdle(): Promise<void> {
    return this._idle;
  }

  // Called by factory after setup — starts the idle→running loop
  start(): void {
    this._loop();
  }

  // Called by handle.dispose()
  async dispose(): Promise<void> {
    if (this._status === "disposed") return;
    this.cancel();
    await this._idle;
    this._status = "disposed";
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _assertNotDisposed(): void {
    if (this._status === "disposed") {
      throw new Error(`Agent ${this.id} is disposed`);
    }
  }

  private _wake(): void {
    if (this._status === "idle") this._loop();
  }

  private _loop(): void {
    if (this._status !== "idle") return;
    if (!this._inbox.hasTurn && !this._inbox.hasStep) return;

    this._status = "running";
    let resolve!: () => void;
    this._idle = new Promise<void>((res) => { resolve = res; });
    this._resolveIdle = resolve;

    this._ctrl = new AbortController();
    const signal = this._ctrl.signal;

    (async () => {
      try {
        while (this._inbox.hasTurn || this._inbox.hasStep) {
          if (this._status === "stopping") break;
          this._lastRendered = await runTurn({
            ctx:          this._ctx,
            agent:        this,
            inbox:        this._inbox,
            session:      this.session,
            binding:      this._binding,
            signal,
            lastRendered: this._lastRendered,
          });
        }
      } finally {
        if (this._status !== "disposed") this._status = "idle";
        this._resolveIdle?.();
      }
    })();
  }
}
