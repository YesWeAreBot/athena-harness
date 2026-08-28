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
 * Generic accessor factory — one line per derived property.
 *
 * Mirrors Satori's `defineAccessor`: get/set a deep path on the instance
 * with lazy creation of intermediate objects on set. `undefined` values
 * are never written (see satorijs/satori#166).
 */
// oxlint-disable-next-line anti-slop/no-object-parameters
export function defineAccessor(prototype: object, name: string, keys: string[]): void {
  Object.defineProperty(prototype, name, {
    get() {
      return keys.reduce((data, key) => data?.[key], this);
    },
    set(value) {
      if (value === undefined) return;
      const path = keys.slice();
      const last = path.pop()!;
      const data = path.reduce((obj, key) => (obj[key] ??= {}), this);
      data[last] = value;
    },
    configurable: true,
  });
}

/**
 * The isolate symbol a context resolves `nerve` under.
 *
 * Two Lives isolate `nerve`, so this identifies which Nerve domain a context —
 * a Body's or a listener's — belongs to. Contexts outside any Life share the
 * root value.
 */
function nerveDomain(ctx: Context): symbol | undefined {
  return ctx[Context.isolate]["nerve"];
}

/**
 * Unified runtime envelope for every event travelling from a Nerve Body
 * into Cortex. Follows the Satori Session model: the payload lives in
 * `session.event`, and derived views (`content`, `channelId`, ...) are
 * accessors attached to the prototype by protocol layers (protocol-im via
 * `defineAccessor`, computed properties via `Object.defineProperty`).
 */
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: interface declares accessor types, class provides runtime envelope (satori Session pattern)
export class Session {
  /** Unique sequence number within this process. */
  public sn: number;

  /** The Body that received this event. */
  public readonly body: Body<unknown>;

  /** The raw event payload. */
  public event: Event;

  constructor(body: Body<unknown>, event: Partial<Event>) {
    event.selfId ??= body.selfId;
    event.platform ??= body.platform;
    event.timestamp ??= Date.now();
    // SAFETY: every base field is either provided or defaulted above, so the
    // partial is fully populated and structurally matches Event.
    this.event = event as Event;
    this.sn = ++body.ctx.nerve._sessionSeq;
    this.body = body;
  }

  get sid(): string {
    return `${this.event.platform}:${this.event.selfId}`;
  }

  /**
   * Restrict delivery to the Body's own Nerve domain.
   *
   * Cordis events are process-global: a listener anywhere receives an emit from
   * anywhere unless the emitted `thisArg` filters it. `NerveService` therefore
   * emits every Session with the Session itself as `thisArg`, and this filter
   * keeps a second Life from observing — and archiving — another Life's events.
   */
  [Context.filter](target: Context): boolean {
    return nerveDomain(target) === nerveDomain(this.body.ctx);
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

// Base accessors — always available (satori pattern).
defineAccessor(Session.prototype, "type", ["event", "type"]);
defineAccessor(Session.prototype, "selfId", ["event", "selfId"]);
defineAccessor(Session.prototype, "platform", ["event", "platform"]);
defineAccessor(Session.prototype, "timestamp", ["event", "timestamp"]);

export interface Session {
  type: string;
  selfId: string;
  platform: string;
  timestamp: number;
}

/**
 * Abstract base class for all platform connections.
 * Subclasses implement `connect` / `disconnect` and the methods they
 * support. There are no placeholder methods — a missing capability is
 * simply absent on the prototype and detected via `supports()`.
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
    // SAFETY: `this` is always a concrete Body subclass; the cast aligns the
    // generic parameter with the register() signature.
    const unregister = this.ctx.nerve.register(this as Body<unknown>);
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

// ─── BodyRegistry ───────────────────────────────────────────────────────────

/**
 * Each Nerve package injects its Body type here via `declare module`.
 * `NerveService.get()` returns the union of all registered types.
 *
 * Example injections:
 *   protocol-im:  interface BodyRegistry { im: IMBody }
 *   nerve-onebot: interface BodyRegistry { onebot: OneBotBody }
 */
export interface BodyRegistry {
  // Packages inject their Body types here.
}

/** Union of all registered Body types. Falls back to Body if the registry is empty. */
export type AnyBody = BodyRegistry[keyof BodyRegistry] extends never ? Body : BodyRegistry[keyof BodyRegistry];

declare module "cordis" {
  interface Context {
    nerve: NerveService;
  }

  interface Events {
    "internal/session"(session: Session): void;
  }
}

/** Manages all Body instances. */
export class NerveService extends Service {
  /** Monotonic sequence shared by every Session in this process. */
  public _sessionSeq = 0;

  constructor(ctx: Context) {
    super(ctx, "nerve");
    ctx.on("internal/session", (session: Session) => {
      // `internal/session` reaches every NerveService in the process, so only
      // the one owning the Body's domain re-emits; otherwise a second Life
      // would emit another Life's events a second time.
      if (nerveDomain(session.body.ctx) !== nerveDomain(ctx)) return;

      // Re-emit from the source Body's context, with the Session as `thisArg`
      // so `Session[Context.filter]` keeps delivery inside that domain.
      // SAFETY: runtime event names are dynamic (onebot/poke, message-created,
      // ...); cordis overloads `emit` on `keyof Events`, which cannot express
      // them, so we bypass the static signature once at the boundary. The
      // concrete signatures remain declared in cordis.Events.
      const emit = session.body.ctx.emit as (thisArg: object, name: string, ...args: unknown[]) => void;
      if (session.type === "internal") {
        // SAFETY: `_type` is set by setInternal before dispatch; internal
        // events always carry it.
        emit(session, session.event._type!, session.event._data, session.body);
        return;
      }
      emit(session, session.type, session);
    });
  }

  public bodies: Array<Body<unknown>> = [];

  /** Register a Body and return an unregister function. */
  register(body: Body<unknown>): () => void {
    this.bodies.push(body);
    return () => {
      const index = this.bodies.indexOf(body);
      if (index >= 0) this.bodies.splice(index, 1);
    };
  }

  /** Find a Body by its stable identifier. Returns the BodyRegistry union. */
  get(sid: string): AnyBody | undefined {
    // SAFETY: every registered Body is an instance of a BodyRegistry member
    // (each package augments the registry when it registers its body type),
    // so the find result is always a member of the AnyBody union.
    const found = this.bodies.find((body) => body.sid === sid);
    // SAFETY: see above — `found` is a registered Body, hence in the union.
    return found as AnyBody | undefined;
  }
}
