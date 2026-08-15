import type { Persistence, Session } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { AgentLoopAccess } from "../agent-loop/types.js";
import "../body/index.js";
import type { PerceptEvent } from "../body/types.js";
import type { LifeMemory } from "../memory/index.js";
import type { ModeRegistry } from "../mode/index.js";
import type { ModeContext, ModeHandle } from "../mode/types.js";
import type { Scheduler } from "../scheduler/index.js";
import type { ModeSchedulerAccess, ScheduledTaskOptions } from "../scheduler/types.js";
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

  async resume(input: ResumeLifeInput): Promise<LifeHandle> {
    const persist = this.ctx.get("persist") as Persistence | undefined;
    if (persist) {
      const prepared = await persist.prepare(input.id);
      try {
        const session = this.ctx.sessions.restore(prepared.header, prepared.events);
        await prepared.close();
        return this.register(session);
      } catch (error) {
        await prepared.close();
        throw error;
      }
    }
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

    const modeContext = (): ModeContext => ({
      lifeId: life.id,
      life,
      session,
      bodies: {
        dispatch: <T>(bodyId: string, kind: string, data: T) => this.ctx.bodies.dispatch(bodyId, kind, data),
        act: (bodyId: string, actuatorId: string, action: unknown) => this.ctx.bodies.act(bodyId, actuatorId, action),
      },
      memory: this.ctx.get("memory") as LifeMemory | undefined,
      scheduler: createModeScheduler(this.ctx, life.id),
      agentLoop: this.ctx.get("agentLoop") as AgentLoopAccess | undefined,
    });

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
      createMode: async (name, config) => {
        if (disposed) throw new Error(`Life is disposed: ${life.id}`);
        const modes = this.ctx.get("modes") as ModeRegistry | undefined;
        if (!modes) throw new Error("ModeRegistry is not installed");
        const created = await modes.create(name, config, modeContext());
        await handle.setMode(created);
        return created;
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

function createModeScheduler(ctx: Context, lifeId: string): ModeSchedulerAccess | undefined {
  const scheduler = ctx.get("scheduler") as Scheduler | undefined;
  if (!scheduler) return undefined;
  return {
    schedule: (options: Omit<ScheduledTaskOptions, "lifeId" | "owner">) => scheduler.schedule({ ...options, lifeId }),
    cancel: (id: string) => scheduler.cancel(id),
    cancelAll: () => scheduler.cancelByLife(lifeId),
  };
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
