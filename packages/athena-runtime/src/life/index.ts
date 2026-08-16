import "@athena/agent";
import type { AgentHandle, AgentRegistry } from "@athena/agent";
import type { Session, SessionBinding } from "@athena/session";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { AgentLoopAccess } from "../agent-loop/types.js";
import "../body/index.js";
import type { BodyRegistry } from "../body/index.js";
import type { PerceptEvent } from "../body/types.js";
import type { LifeMemory } from "../memory/index.js";
import type { ModeRegistry } from "../mode/index.js";
import type { ModeActuatorInterest, ModeCapabilities, ModeContext, ModeHandle, ModePerceptInterest } from "../mode/types.js";
import type { Scheduler } from "../scheduler/index.js";
import type { ModeSchedulerAccess, ScheduledTaskOptions } from "../scheduler/types.js";
import type { CreateLifeAgentInput, CreateLifeInput, Life, LifeHandle, ResumeLifeAgentInput, ResumeLifeInput } from "./types.js";

export class LifeRegistry extends Service {
  static provide = "lives";

  private lives = new Map<string, LifeHandle>();

  constructor(ctx: Context) {
    super(ctx, "lives");
    this.ctx.effect(() => {
      const dispose = this.ctx.on("body/percept", (event: PerceptEvent) => {
        for (const handle of this.lives.values()) {
          if (handle.hasBody(event.bodyId)) {
            void Promise.resolve(handle.dispatchPercept(event)).catch((error: unknown) => this.ctx.emit("life/error", { id: handle.life.id, error }));
          }
        }
      });
      const modeDispose = this.ctx.on("mode/disposed", (event: { id: string }) => {
        for (const handle of this.lives.values()) {
          if (handle.activeModeId === event.id) {
            void Promise.resolve(handle.setMode(undefined)).catch((error: unknown) => this.ctx.emit("life/error", { id: handle.life.id, error }));
          }
        }
      });
      const bodyDispose = this.ctx.on("body/disposed", (event: { id: string }) => {
        for (const handle of this.lives.values()) {
          if (handle.hasBody(event.id)) {
            void Promise.resolve(handle.detachBody(event.id)).catch((error: unknown) => this.ctx.emit("life/error", { id: handle.life.id, error }));
          }
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
    const persistence = this.ctx.sessions.persistence;
    if (persistence) {
      const prepared = await persistence.prepare(input.id);
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

  async createWithAgent(input: CreateLifeAgentInput): Promise<LifeHandle> {
    const agents = this.ctx.get("agents") as AgentRegistry | undefined;
    if (!agents) throw new Error("AgentRegistry is not installed");

    const session = this.ctx.sessions.create({ id: input.id });
    let binding: SessionBinding | undefined;
    if (this.ctx.sessions.persistence) {
      try {
        binding = await this.ctx.sessions.persistence.create(session.header);
      } catch (error) {
        this.ctx.sessions.remove(session.id);
        throw error;
      }
    }
    let agentHandle: AgentHandle | undefined;
    try {
      agentHandle = await agents.create({
        id: session.id,
        session,
        binding,
        model: input.agentLoop.model,
        maxSteps: input.agentLoop.maxSteps,
        setup: input.agentLoop.setup,
      });
      return this.register(session, agentHandle);
    } catch (error) {
      try {
        if (agentHandle) await agentHandle.dispose();
        else await binding?.close();
      } finally {
        this.ctx.sessions.remove(session.id);
      }
      throw error;
    }
  }

  async resumeWithAgent(input: ResumeLifeAgentInput): Promise<LifeHandle> {
    const agents = this.ctx.get("agents") as AgentRegistry | undefined;
    if (!agents) throw new Error("AgentRegistry is not installed");

    const persistence = this.ctx.sessions.persistence;
    let session: Session;
    let binding: SessionBinding | undefined;
    if (persistence) {
      const prepared = await persistence.prepare(input.id);
      try {
        session = this.ctx.sessions.restore(prepared.header, prepared.events);
        await prepared.close();
      } catch (error) {
        await prepared.close();
        throw error;
      }
      try {
        binding = await persistence.open(input.id);
      } catch (error) {
        this.ctx.sessions.remove(session.id);
        throw error;
      }
    } else {
      const existing = this.ctx.sessions.get(input.id);
      if (!existing) {
        throw new Error(`Life session not found: ${input.id}`);
      }
      session = existing;
    }

    let agentHandle: AgentHandle | undefined;
    try {
      agentHandle = await agents.resume({
        id: session.id,
        session,
        binding,
        model: input.agentLoop.model,
        maxSteps: input.agentLoop.maxSteps,
        setup: input.agentLoop.setup,
      });
      return this.register(session, agentHandle);
    } catch (error) {
      try {
        if (agentHandle) await agentHandle.dispose();
        else await binding?.close();
      } finally {
        this.ctx.sessions.remove(session.id);
      }
      throw error;
    }
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

  private register(session: Session, agentHandle?: AgentHandle): LifeHandle {
    if (this.lives.has(session.id)) {
      throw new Error(`Life already exists: ${session.id}`);
    }
    let disposed = false;
    let activeMode: ModeHandle | undefined;
    const bodies = new Set<string>();

    const life: Life = {
      id: session.id,
      session,
      ...(agentHandle ? { agent: agentHandle.agent } : {}),
      get activeModeId() {
        return activeMode?.id;
      },
      get bodyIds() {
        return [...bodies];
      },
    };

    const modeContext = (capabilities?: ModeCapabilities): ModeContext => ({
      lifeId: life.id,
      life,
      session,
      bodies: {
        dispatch: <T>(bodyId: string, kind: string, data: T) => this.ctx.bodies.dispatch(bodyId, kind, data),
        act: async (bodyId: string, actuatorId: string, action: unknown) => {
          const actuator = this.ctx.bodies.get(bodyId)?.actuators?.find((item) => item.id === actuatorId);
          if (!canUseActuator(capabilities, bodyId, actuatorId, actuator?.kind)) {
            throw new Error(`Mode is not allowed to use actuator: ${bodyId}/${actuatorId}`);
          }
          return this.ctx.bodies.act(bodyId, actuatorId, action);
        },
      },
      memory: this.ctx.get("memory") as LifeMemory | undefined,
      scheduler: createModeScheduler(this.ctx, life.id),
      agentLoop: this.ctx.get("agentLoop") as AgentLoopAccess | undefined,
      agent: agentHandle?.agent,
    });

    const handle: LifeHandle = {
      life,
      get agent() {
        return life.agent;
      },
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
        const definition = modes.get(name);
        const created = await modes.create(name, config, modeContext(definition?.capabilities));
        try {
          await handle.setMode(created);
        } catch (error) {
          await stopMode(created);
          throw error;
        }
        return created;
      },
      dispatchPercept: async (event: PerceptEvent) => {
        if (activeMode?.disposed) activeMode = undefined;
        if (!activeMode?.handle) return false;
        if (!acceptsPercept(activeMode, event)) return false;
        return await activeMode.handle(event);
      },
      attachBody: async (bodyId: string) => {
        if (disposed) throw new Error(`Life is disposed: ${life.id}`);
        const bodyRegistry = this.ctx.get("bodies") as BodyRegistry | undefined;
        if (bodyRegistry && !bodyRegistry.get(bodyId)) {
          throw new Error(`Body not registered: ${bodyId}`);
        }
        bodies.add(bodyId);
      },
      detachBody: async (bodyId: string) => {
        if (disposed) throw new Error(`Life is disposed: ${life.id}`);
        bodies.delete(bodyId);
      },
      hasBody: (bodyId: string) => bodies.has(bodyId),
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        this.lives.delete(life.id);
        try {
          await stopMode(activeMode);
          activeMode = undefined;
          await agentHandle?.dispose();
        } finally {
          this.ctx.sessions.remove(life.id);
        }
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

function acceptsPercept(mode: ModeHandle, event: PerceptEvent): boolean {
  const capabilities = mode.capabilities;
  if (!capabilities) return true;
  if (capabilities.bodies && !capabilities.bodies.includes(event.bodyId)) return false;
  return capabilities.percepts.some((interest) => matchesPerceptInterest(interest, event));
}

function matchesPerceptInterest(interest: ModePerceptInterest, event: PerceptEvent): boolean {
  if (interest.body !== undefined && interest.body !== event.bodyId) return false;
  if (interest.kind !== undefined && interest.kind !== event.kind) return false;
  return true;
}

function canUseActuator(capabilities: ModeCapabilities | undefined, bodyId: string, actuatorId: string, kind: string | undefined): boolean {
  if (!capabilities) return true;
  if (capabilities.bodies && !capabilities.bodies.includes(bodyId)) return false;
  return capabilities.actuators.some((interest) => matchesActuatorInterest(interest, bodyId, actuatorId, kind));
}

function matchesActuatorInterest(interest: ModeActuatorInterest, bodyId: string, actuatorId: string, kind: string | undefined): boolean {
  if (interest.body !== undefined && interest.body !== bodyId) return false;
  if (interest.actuator !== undefined && interest.actuator !== actuatorId) return false;
  if (interest.kind !== undefined && interest.kind !== kind) return false;
  return true;
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

  interface Events {
    "life/error"(event: { id: string; error: unknown }): void;
  }
}
