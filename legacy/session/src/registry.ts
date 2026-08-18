import { Service } from "cordis";
import type { Context } from "cordis";

import { Session, restoreSession } from "./session.js";
import type { SessionEvent, SessionHeader } from "./types.js";

// ── Persistence interfaces ─────────────────────────────────────────────────
export interface SessionBinding {
  append(events: readonly SessionEvent[]): void; // sync, buffered
  flush(): Promise<void>; // drain buffer to disk
  close(): Promise<void>;
}

export interface PreparedSession {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  close(): Promise<void>;
}

export interface SessionPersistenceHandler {
  prepare(id: string): Promise<PreparedSession>;
  create(header: SessionHeader): Promise<SessionBinding>;
  open(id: string): Promise<SessionBinding>;
}

declare module "cordis" {
  interface Context {
    sessions: SessionRegistry;
  }
}

// ── Registry ───────────────────────────────────────────────────────────────
export class SessionRegistry extends Service {
  static provide = "sessions";

  private _sessions = new Map<string, Session>();
  private _persistence: SessionPersistenceHandler | undefined;

  constructor(ctx: Context) {
    super(ctx, "sessions");
  }

  create(opts?: { id?: string }): Session {
    const session = new Session(opts?.id ? { id: opts.id } : undefined);
    if (this._sessions.has(session.id)) {
      throw new Error(`Session already exists: ${session.id}`);
    }
    this._sessions.set(session.id, session);
    return session;
  }

  restore(header: SessionHeader, events: readonly SessionEvent[]): Session {
    if (this._sessions.has(header.id)) {
      throw new Error(`Session already exists: ${header.id}`);
    }
    const session = restoreSession(header, events);
    this._sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    return this._sessions.get(id);
  }

  remove(id: string): void {
    this._sessions.delete(id);
  }

  /**
   * Single-slot persistence registration.
   * Throws if a handler is already registered.
   * Returns a Cordis-effect cleanup that removes the handler.
   */
  setPersistence(handler: SessionPersistenceHandler): () => void {
    if (this._persistence) {
      throw new Error("SessionPersistenceHandler is already registered");
    }
    this._persistence = handler;
    return this.ctx.effect(() => () => {
      if (this._persistence === handler) this._persistence = undefined;
    });
  }

  get persistence(): SessionPersistenceHandler | undefined {
    return this._persistence;
  }
}
