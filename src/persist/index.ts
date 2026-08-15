import { Service } from "cordis";
import type { Context } from "cordis";

import type { Awaitable } from "../awaitable.js";
import type { SessionEvent, SessionHeader } from "../session/types.js";

export interface PersistenceSessionBinding {
  readonly id: string;
  append(events: readonly SessionEvent[]): void;
  flush(): Promise<void>;
  close(): Promise<void>;
}

export interface PreparedSession {
  readonly header: SessionHeader;
  readonly events: readonly SessionEvent[];
  close(): Promise<void>;
}

export abstract class Persistence extends Service {
  static provide = "persist";

  constructor(ctx: Context) {
    super(ctx, "persist");
  }

  abstract create(header: SessionHeader): Awaitable<PersistenceSessionBinding>;

  abstract prepare(id: string): Awaitable<PreparedSession>;
}

declare module "cordis" {
  interface Context {
    persist: Persistence;
  }
}
