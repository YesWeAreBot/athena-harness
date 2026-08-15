import { Service } from "cordis";
import type { Context } from "cordis";

import { deepFreeze } from "../freeze.js";
import { createId } from "../id.js";
import { MODEL_VISIBLE_EVENT_TYPES, NON_SURFACE_EVENT_TYPES, type SessionEventMap } from "./events.js";
import { SurfaceManager } from "./surface.js";
import type { AppendOptions, SessionEvent, SessionHeader, SessionOptions, SessionSnapshot } from "./types.js";

export class Session {
  readonly header: SessionHeader;

  readonly surface = new SurfaceManager();

  private events: SessionEvent[] = [];

  constructor(options: SessionOptions = {}) {
    this.header = {
      id: options.id ?? createId("session"),
      createdAt: Date.now(),
    };
  }

  get id(): string {
    return this.header.id;
  }

  get length(): number {
    return this.events.length;
  }

  get snapshotEvents(): readonly SessionEvent[] {
    return Object.freeze([...this.events]);
  }

  append<K extends keyof SessionEventMap>(type: K, data: SessionEventMap[K], options?: AppendOptions): SessionEvent<SessionEventMap[K]>;
  append<T>(type: string, data: T, options?: AppendOptions): SessionEvent<T>;
  append(type: string, data: unknown, options: AppendOptions = {}): SessionEvent<unknown> {
    if (options.surfaceOp && NON_SURFACE_EVENT_TYPES.has(type)) {
      throw new Error(`Surface op is forbidden for lifecycle event: ${type}`);
    }
    if (MODEL_VISIBLE_EVENT_TYPES.has(type) && !options.surfaceOp) {
      throw new Error(`Model-visible event requires a Surface op: ${type}`);
    }

    const seq = this.events.length + 1;
    let sourceEventSeqs: readonly number[] | undefined;
    if (options.surfaceOp === "append") {
      this.surface.append(seq);
      sourceEventSeqs = [seq];
    } else if (options.surfaceOp) {
      const { start, end } = options.surfaceOp;
      const node = this.surface.replace(seq, start, end, options.sourceEventSeqs ?? []);
      sourceEventSeqs = node.sourceEventSeqs;
    }

    const event = Object.freeze({
      type,
      seq,
      time: Date.now(),
      data: deepFreeze(data),
      ...(options.ignorable ? { ignorable: true } : {}),
      ...(options.surfaceOp ? { surfaceOp: options.surfaceOp } : {}),
      ...(sourceEventSeqs ? { sourceEventSeqs: Object.freeze([...sourceEventSeqs]) } : {}),
    });
    this.events.push(event);
    return event;
  }

  getEvent(seq: number): SessionEvent | undefined {
    return this.events.find((event) => event.seq === seq);
  }

  snapshot(): SessionSnapshot {
    return {
      header: { ...this.header },
      events: [...this.events],
      surface: this.surface.snapshot,
    };
  }
}

export class SessionStore extends Service {
  static provide = "sessions";

  private sessions = new Map<string, Session>();

  constructor(ctx: Context) {
    super(ctx, "sessions");
    this.ctx.effect(() => () => {
      this.sessions.clear();
    });
  }

  create(options: SessionOptions = {}): Session {
    const session = new Session(options);
    if (this.sessions.has(session.id)) {
      throw new Error(`Session already exists: ${session.id}`);
    }
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  remove(id: string): boolean {
    return this.sessions.delete(id);
  }
}

export const sessionStore = {
  apply(ctx: Context) {
    new SessionStore(ctx);
  },
};

declare module "cordis" {
  interface Context {
    sessions: SessionStore;
  }
}
