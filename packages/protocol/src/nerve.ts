import { Context, Service } from "cordis";

export type Status = "online" | "offline" | "connecting" | "disconnecting";

/**
 * Base event data carried inside a Session.
 *
 * This is the wire-shaped payload: concrete event interfaces (e.g.
 * `IMMessageEvent` in protocol-im) narrow this shape per event type, and
 * the Session class adds runtime behavior on top of it.
 */
export interface Event {
  /** Event type discriminant. */
  type: string;
  /** Unique event ID for idempotency. */
  id: string;
  /** Id of the login that received this event. */
  selfId: string;
  /** Platform or nerve type identifier. */
  platform: string;
  /** When the event occurred (ms). */
  timestamp: number;
  /** Internal subtype (satori pattern); present on `internal` sessions. */
  _type?: string;
  /** Internal payload (satori pattern); present on `internal` sessions. */
  _data?: unknown;
}

/**
 * Unified runtime envelope for every event travelling from a Nerve Body
 * into Cortex. Follows the Satori Session model: the payload lives in
 * `session.event`, and derived views (`content`, `channelId`, ...) are
 * accessors provided by protocol layers (IMSession in protocol-im).
 */
export class Session {
  /** Unique sequence number within this process. */
  public sn: number;
  /** Alias of `sn` for backward compatibility. */
  public id: number;

  /** The Body that received this event. */
  public readonly body: Body;

  /** The raw event payload. */
  public event: Event;

  constructor(body: Body, event: Partial<Event>) {
    event.selfId ??= body.selfId;
    event.platform ??= body.platform;
    event.timestamp ??= Date.now();
    // SAFETY: every base field is either provided or defaulted above, so the
    // partial is fully populated and structurally matches Event.
    this.event = event as Event;
    this.sn = this.id = ++body.ctx.nerve._sessionSeq;
    this.body = body;
  }

  get type(): string {
    return this.event.type;
  }

  set type(value: string) {
    this.event.type = value;
  }

  get selfId(): string {
    return this.event.selfId;
  }

  set selfId(value: string) {
    this.event.selfId = value;
  }

  get platform(): string {
    return this.event.platform;
  }

  set platform(value: string) {
    this.event.platform = value;
  }

  get timestamp(): number {
    return this.event.timestamp;
  }

  set timestamp(value: number) {
    this.event.timestamp = value;
  }

  get sid(): string {
    return `${this.platform}:${this.selfId}`;
  }

  /** Mark this session as an internal event with a subtype and payload. */
  setInternal<T>(type: string, data: T): void {
    this.event._type = type;
    this.event._data = data;
  }

  toJSON() {
    return { ...this.event, sn: this.sn };
  }
}

/**
 * Abstract base class for all platform connections.
 * Subclasses implement `connect` / `disconnect` and the IM methods they
 * support; unsupported methods fall back to `_notImplemented`.
 */
export abstract class Body<T = unknown> {
  public selfId!: string;
  public abstract platform: string;
  public status: Status = "offline";
  public error?: Error;

  constructor(
    public ctx: Context,
    public config: T,
  ) {}

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;

  /**
   * Default service lifecycle: register into `ctx.nerve`, start the
   * connection, and disconnect on dispose. Subclasses may override but
   * should call `yield* super[Service.init]()` to keep registration.
   */
  *[Service.init](): Generator<unknown, void, unknown> {
    const unregister = this.ctx.nerve.register(this);
    yield unregister;
    yield () => {
      this.disconnect();
    };
    this.connect();
  }

  get sid(): string {
    return `${this.platform}:${this.selfId}`;
  }

  /** Whether the connection is active (online or connecting). */
  get isActive(): boolean {
    return this.status === "online" || this.status === "connecting";
  }

  online(): void {
    this.status = "online";
    this.error = undefined;
  }

  offline(error?: Error): void {
    this.status = "offline";
    if (error) this.error = error;
  }

  /** Default failure for methods a subclass does not implement. */
  protected _notImplemented(name: string): Promise<never> {
    return Promise.reject(new Error(`not implemented: ${name}`));
  }

  /** Factory helper to create a Session envelope. */
  session(event: Partial<Event> = {}): Session {
    return new Session(this, event);
  }

  /**
   * Dispatch a Session onto the Cordis event bus.
   *
   * The session first travels through `internal/session` — the single
   * normalization entry point (server relay, plugin interception) — and is
   * then re-emitted from the Body's own context under its concrete type so
   * that Life-scoped listeners receive it.
   */
  dispatch(session: Session): void {
    this.ctx.emit("internal/session", session);
  }
}

declare module "cordis" {
  interface Context {
    nerve: NerveService;
  }
}

/** Manages all Body instances. */
export class NerveService extends Service {
  /** Monotonic sequence shared by every Session in this process. */
  public _sessionSeq = 0;

  constructor(ctx: Context) {
    super(ctx, "nerve");
    ctx.on("internal/session", (session: Session) => {
      // Re-emit from the source Body's context so the event stays within the
      // originating Life group (cordis scoping bubbles child → parent).
      // SAFETY: runtime event names are dynamic (onebot/poke, message-created,
      // ...); cordis overloads `emit` on `keyof Events`, which cannot express
      // them, so we bypass the static signature once at the boundary. The
      // concrete signatures remain declared in cordis.Events.
      const emit = session.body.ctx.emit as (name: string, ...args: unknown[]) => void;
      if (session.type === "internal") {
        // SAFETY: `_type` is set by setInternal before dispatch; internal
        // events always carry it.
        emit(session.event._type!, session.event._data, session.body);
        return;
      }
      emit(session.type, session);
    });
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

declare module "cordis" {
  interface Events {
    "internal/session"(session: Session): void;
  }
}
