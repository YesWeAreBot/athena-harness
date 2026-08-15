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
      const modeDispose = this.ctx.on("mode/disposed", (event: { id: string }) => {
        for (const handle of this.lives.values()) {
          if (handle.activeModeId === event.id) void handle.setMode(undefined);
        }
      });
      const bodyDispose = this.ctx.on("body/disposed", (event: { id: string }) => {
        for (const handle of this.lives.values()) {
          if (handle.hasBody(event.id)) void handle.detachBody(event.id);
        }
      });
      return () => {
        dispose();
        modeDispose();
        bodyDispose();
      };
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
    let disposed = false;
    let activeMode: ModeHandle | undefined;
    const bodies = new Set<string>();

    const life: Life = {
      id: session.id,
      session,
      get activeModeId() {
        return activeMode?.id;
      },
      get bodyIds() {
        return [...bodies];
      },
    };

    const handle: LifeHandle = {
      life,
      get activeModeId() {
        return life.activeModeId;
      },
      setMode: async (next) => {
        if (disposed) throw new Error(`Life is disposed: ${life.id}`);
        if (next === activeMode) return;
        if (next?.disposed) throw new Error(`Mode is disposed: ${next.id}`);
        await stopMode(activeMode);
        activeMode = next;
        try {
          await activeMode?.start?.();
        } catch (error) {
          await stopMode(activeMode);
          activeMode = undefined;
          throw error;
        }
      },
      dispatchPercept: async (event: PerceptEvent) => {
        if (activeMode?.disposed) activeMode = undefined;
        return activeMode?.handle ? await activeMode.handle(event) : false;
      },
      attachBody: async (bodyId: string) => {
        if (disposed) throw new Error(`Life is disposed: ${life.id}`);
        bodies.add(bodyId);
      },
      detachBody: async (bodyId: string) => {
        bodies.delete(bodyId);
      },
      hasBody: (bodyId: string) => bodies.has(bodyId),
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        this.lives.delete(life.id);
        await stopMode(activeMode);
        activeMode = undefined;
        this.ctx.sessions.remove(life.id);
      },
    };
    this.lives.set(life.id, handle);
    return handle;
  }
}

async function stopMode(mode: ModeHandle | undefined): Promise<void> {
  if (!mode) return;
  if (mode.dispose) await mode.dispose();
  else await mode.stop?.();
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
