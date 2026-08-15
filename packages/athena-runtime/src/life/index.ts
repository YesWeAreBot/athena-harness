import type { Session } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import "../body/index.js";
import type { PerceptEvent } from "../body/types.js";
import type { ModeHandle } from "../mode/types.js";
import type { CreateLifeInput, Life, LifeHandle, ResumeLifeInput } from "./types.js";

export class LifeRegistry extends Service {
  static provide = "lives";

  private lives = new Map<string, LifeHandle>();

  constructor(ctx: Context) {
    super(ctx, "lives");
    this.ctx.effect(() => {
      const dispose = this.ctx.on("body/percept", (event: PerceptEvent) => {
        for (const handle of this.lives.values()) {
          if (handle.hasBody(event.bodyId)) void handle.dispatchPercept(event);
        }
      });
      return () => dispose();
    });
    this.ctx.effect(() => async () => {
      await Promise.allSettled([...this.lives.values()].map((handle) => handle.dispose()));
    });
  }

  create(input: CreateLifeInput = {}): LifeHandle {
    const session = this.ctx.sessions.create({ id: input.id });
    return this.register(session);
  }

  resume(input: ResumeLifeInput): LifeHandle {
    const session = this.ctx.sessions.get(input.id);
    if (!session) {
      throw new Error(`Life session not found: ${input.id}`);
    }
    return this.register(session);
  }

  get(id: string): Life | undefined {
    return this.lives.get(id)?.life;
  }

  list(): Life[] {
    return [...this.lives.values()].map((handle) => handle.life);
  }

  async dispose(id: string): Promise<void> {
    const handle = this.lives.get(id);
    if (handle) await handle.dispose();
  }

  private register(session: Session): LifeHandle {
    if (this.lives.has(session.id)) {
      throw new Error(`Life already exists: ${session.id}`);
    }
    const life: Life = {
      id: session.id,
      session,
    };
    let disposed = false;
    let mode: ModeHandle | undefined;
    const bodies = new Set<string>();
    const handle: LifeHandle = {
      life,
      setMode: async (next) => {
        await mode?.stop?.();
        mode = next;
        await mode?.start?.();
      },
      dispatchPercept: async (event: PerceptEvent) => {
        return mode?.handle ? await mode.handle(event) : false;
      },
      attachBody: async (bodyId: string) => {
        bodies.add(bodyId);
      },
      detachBody: async (bodyId: string) => {
        bodies.delete(bodyId);
      },
      hasBody: (bodyId: string) => bodies.has(bodyId),
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        await mode?.stop?.();
        this.lives.delete(life.id);
        this.ctx.sessions.remove(life.id);
      },
    };
    this.lives.set(life.id, handle);
    return handle;
  }
}

export const lifeRegistry = {
  inject: ["sessions"] as const,
  apply(ctx: Context) {
    new LifeRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    lives: LifeRegistry;
  }
}
