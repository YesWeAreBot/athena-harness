import { Service } from "cordis";
import type { Context } from "cordis";

import { createId } from "../id.js";
import type { AppendOptions, SessionEvent, SessionHeader, SessionOptions, SessionSnapshot } from "./types.js";

function freeze<T>(value: T): T {
  return Object.freeze(value) as T;
}

export class Session {
  readonly header: SessionHeader;

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
    return this.events;
  }

  append<T>(type: string, data: T, options: AppendOptions = {}): SessionEvent<T> {
    const event = Object.freeze({
      type,
      seq: this.events.length + 1,
      time: Date.now(),
      data: freeze(data),
      ...(options.ignorable ? { ignorable: true } : {}),
    });
    this.events.push(event);
    return event;
  }

  snapshot(): SessionSnapshot {
    return {
      header: { ...this.header },
      events: [...this.events],
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
