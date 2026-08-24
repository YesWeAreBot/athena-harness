import { Context, Service } from "cordis";

export type Status = "online" | "offline" | "connecting" | "disconnecting";

/**
 * Unified event envelope from Nerve into Cortex.
 * Specific payload fields are added by protocol-im and nerve packages.
 */
export interface NerveEvent {
  /** Event type discriminant. */
  type: string;
  /** Unique event ID for idempotency. */
  id: string;
  /** The Body that received this event. */
  selfId: string;
  /** Platform or nerve type identifier. */
  platform: string;
  /** When the event occurred. */
  timestamp: number;
  /** Reference to the receiving Body. This field is non-serializable. */
  body: Body;
}

/** Event map extended by protocol-im and nerve packages. */
export interface NerveEventMap {}

/** Abstract base class for all platform connections. */
export abstract class Body<T = unknown> {
  public selfId!: string;
  public abstract platform: string;
  public status: Status = "offline";

  constructor(
    public ctx: Context,
    public config: T,
  ) {}

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  get sid(): string {
    return `${this.platform}:${this.selfId}`;
  }

  online(): void {
    this.status = "online";
  }

  offline(): void {
    this.status = "offline";
  }

  /** Dispatch a NerveEvent onto the Cordis event bus. */
  dispatch(event: NerveEvent): void {
    // SAFETY: NerveEvent is deliberately open for declaration-merged event payloads; Cordis cannot infer a dynamic event name.
    this.ctx.emit(event.type as any, event as never);
  }

  /** Factory helper to create a NerveEvent. */
  createEvent(partial: Partial<NerveEvent> & { type: string }): NerveEvent {
    return {
      id: partial.id ?? Math.random().toString(36).slice(2),
      selfId: this.selfId,
      platform: this.platform,
      timestamp: partial.timestamp ?? Date.now(),
      body: this,
      ...partial,
    };
  }
}

declare module "cordis" {
  interface Context {
    nerve: NerveService;
  }
}

/** Manages all Body instances. */
export class NerveService extends Service {
  constructor(ctx: Context) {
    super(ctx, "nerve");
  }

  public bodies: Body[] = [];

  /** Register a Body and return an unregister function. */
  register(body: Body): () => void {
    this.bodies.push(body);
    return () => {
      const index = this.bodies.indexOf(body);
      if (index >= 0) this.bodies.splice(index, 1);
    };
  }

  /** Find a Body by its stable identifier. */
  get(sid: string): Body | undefined {
    return this.bodies.find((body) => body.sid === sid);
  }
}
