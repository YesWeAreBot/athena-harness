import "@athena/agent";
import type { AgentHandle, AgentRegistry } from "@athena/agent";
import type { Session, SessionBinding } from "@athena/session";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { AgentLoopAccess } from "../agent-loop/types.js";
import "../body/index.js";
import type { BodyRegistry } from "../body/index.js";
import type { ActuatorOptions, PerceptEvent } from "../body/types.js";
import { createId } from "../internal.js";
import type { LifeMemory } from "../memory/index.js";
import type { ModeRegistry } from "../mode/index.js";
import type { ModeActuatorInterest, ModeCapabilities, ModeContext, ModeHandle, ModePerceptInterest } from "../mode/types.js";
import type { Scheduler } from "../scheduler/index.js";
import type { ModeSchedulerAccess, ScheduledTaskOptions } from "../scheduler/types.js";
import type {
  CreateLifeAgentInput,
  CreateLifeInput,
  Life,
  LifeHandle,
  PerceptPipeline,
  PerceptRejectReason,
  ResumeLifeAgentInput,
  ResumeLifeInput,
} from "./types.js";

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
    return this.register(session, undefined, input.perceptPipeline);
  }

  async resume(input: ResumeLifeInput): Promise<LifeHandle> {
    const persistence = this.ctx.sessions.persistence;
    if (persistence) {
      const prepared = await persistence.prepare(input.id);
      try {
        const session = this.ctx.sessions.restore(prepared.header, prepared.events);
        await prepared.close();
        return this.register(session, undefined, input.perceptPipeline);
      } catch (error) {
        await prepared.close();
        throw error;
      }
    }
    const session = this.ctx.sessions.get(input.id);
    if (!session) {
      throw new Error(`Life session not found: ${input.id}`);
    }
    return this.register(session, undefined, input.perceptPipeline);
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
      return this.register(session, agentHandle, input.perceptPipeline);
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
      return this.register(session, agentHandle, input.perceptPipeline);
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

  private register(session: Session, agentHandle?: AgentHandle, perceptPipeline?: PerceptPipeline): LifeHandle {
    if (this.lives.has(session.id)) {
      throw new Error(`Life already exists: ${session.id}`);
    }
    let disposed = false;
    let activeMode: ModeHandle | undefined;
    const bodies = new Set<string>();
    let queue: Promise<void> = Promise.resolve();

    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
      const next = queue.then(task, task);
      queue = next.then(
        () => undefined,
        () => undefined,
      );
      return next;
    };

    const applyMode = async (next: ModeHandle | undefined): Promise<void> => {
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
    };

    const life: Life = {
      id: session.id,
      session,
      ...(agentHandle ? { agent: agentHandle.agent } : {}),
      get disposed() {
        return disposed;
      },
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
        act: async (bodyId: string, actuatorId: string, action: unknown, options?: ActuatorOptions) => {
          const actuator = this.ctx.bodies.get(bodyId)?.actuators?.find((item) => item.id === actuatorId);
          if (!canUseActuator(capabilities, bodyId, actuatorId, actuator?.kind)) {
            throw new Error(`Mode is not allowed to use actuator: ${bodyId}/${actuatorId}`);
          }
          return this.ctx.bodies.act(bodyId, actuatorId, action, { ...options, lifeId: life.id });
        },
      },
      memory: this.ctx.get("memory") as LifeMemory | undefined,
      scheduler: {
        schedule: (options) => {
          const provider = providerList(activeMode?.providers?.scheduler).find((item) => item.kinds.includes(options.kind));
          if (provider) return provider.schedule({ ...options, lifeId: life.id });
          const global = createModeScheduler(this.ctx, life.id);
          if (!global) throw new Error("Scheduler is not installed");
          return global.schedule(options);
        },
        cancel: (id) => {
          const global = createModeScheduler(this.ctx, life.id);
          if (global?.cancel(id)) return true;
          return providerList(activeMode?.providers?.scheduler).some((provider) => provider.cancel(id));
        },
        cancelAll: () => {
          createModeScheduler(this.ctx, life.id)?.cancelAll();
          for (const provider of providerList(activeMode?.providers?.scheduler)) provider.cancelAll();
        },
      },
      agentLoop: this.ctx.get("agentLoop") as AgentLoopAccess | undefined,
      agent: agentHandle?.agent,
      model: {
        list: () => providerList(activeMode?.providers?.model),
        resolve: (role) => providerList(activeMode?.providers?.model).find((provider) => provider.roles.includes(role)),
      },
      state: {
        get: async <T>(id: string): Promise<T | undefined> => {
          const provider = providerList(activeMode?.providers?.state).find((item) => item.id === id);
          return provider ? ((await provider.get()) as T) : undefined;
        },
        set: async <T>(id: string, value: T): Promise<void> => {
          const provider = providerList(activeMode?.providers?.state).find((item) => item.id === id);
          if (!provider?.set) throw new Error(`State provider is not installed or has no set: ${id}`);
          await provider.set(value);
        },
      },
      delivery: {
        deliver: async (kind, target, payload) => {
          const provider = providerList(activeMode?.providers?.delivery).find((item) => item.kinds.includes(kind));
          if (!provider?.deliver) throw new Error(`Delivery provider is not installed: ${kind}`);
          return provider.deliver(target, payload);
        },
      },
      media: {
        list: () => [],
        save: async () => {
          throw new Error("Media provider is not installed");
        },
      },
    });

    const routePercept = async (originalEvent: PerceptEvent): Promise<boolean> => {
      if (activeMode?.disposed) activeMode = undefined;
      let event = originalEvent;
      const reject = (reason: PerceptRejectReason, modeId?: string): false => {
        this.ctx.emit("percept/rejected", { id: life.id, modeId, event, reason });
        return false;
      };
      if (perceptPipeline?.attention && !(await perceptPipeline.attention(event))) return reject("attention");
      if (perceptPipeline?.compact) event = await perceptPipeline.compact(event);
      if (!activeMode) return reject("no-mode");
      if (!acceptsPercept(activeMode, event)) return reject("capabilities", activeMode.id);
      const hookResult = await activeMode.hooks?.onPercept?.(event, {
        lifeId: life.id,
        modeId: activeMode.id,
        session,
      });
      if (hookResult === false) return reject("hook", activeMode.id);
      if (!activeMode.handle && hookResult !== true) return reject("no-mode", activeMode.id);
      const handled = activeMode.handle ? await activeMode.handle(event) : true;
      this.ctx.emit("percept/routed", { id: life.id, modeId: activeMode.id, event, handled });
      return handled;
    };

    const handle: LifeHandle = {
      life,
      get agent() {
        return life.agent;
      },
      get disposed() {
        return disposed;
      },
      get activeModeId() {
        return life.activeModeId;
      },
      setMode: (next) =>
        enqueue(async () => {
          await applyMode(next);
        }),
      createMode: (name, config) =>
        enqueue(async () => {
          if (disposed) throw new Error(`Life is disposed: ${life.id}`);
          const modes = this.ctx.get("modes") as ModeRegistry | undefined;
          if (!modes) throw new Error("ModeRegistry is not installed");
          const definition = modes.get(name);
          const created = await modes.create(name, config, modeContext(definition?.capabilities));
          try {
            await applyMode(created);
          } catch (error) {
            await stopMode(created);
            throw error;
          }
          return created;
        }),
      dispatchPercept: (originalEvent) => enqueue(() => routePercept(originalEvent)),
      wake: (reason, data) => enqueue(() => routePercept(createWakeEvent(reason, data))),
      setModel: (providerId) =>
        enqueue(async () => {
          if (disposed) throw new Error(`Life is disposed: ${life.id}`);
          if (!agentHandle?.agent) throw new Error("Life has no Agent");
          const provider = providerList(activeMode?.providers?.model).find((item) => item.id === providerId);
          if (!provider) throw new Error(`Model provider not found: ${providerId}`);
          agentHandle.agent.setModel((await provider.get()) as never);
          this.ctx.emit("model/changed", { id: life.id, providerId, model: agentHandle.agent.model });
        }),
      attachBody: (bodyId) =>
        enqueue(async () => {
          if (disposed) throw new Error(`Life is disposed: ${life.id}`);
          const bodyRegistry = this.ctx.get("bodies") as BodyRegistry | undefined;
          if (bodyRegistry && !bodyRegistry.get(bodyId)) {
            throw new Error(`Body not registered: ${bodyId}`);
          }
          bodies.add(bodyId);
        }),
      detachBody: (bodyId) =>
        enqueue(async () => {
          if (disposed) throw new Error(`Life is disposed: ${life.id}`);
          bodies.delete(bodyId);
        }),
      hasBody: (bodyId: string) => bodies.has(bodyId),
      dispose: () =>
        enqueue(async () => {
          if (disposed) return;
          disposed = true;
          this.lives.delete(life.id);
          try {
            await stopMode(activeMode);
            activeMode = undefined;
            await agentHandle?.dispose();
          } finally {
            this.ctx.sessions.remove(life.id);
            this.ctx.emit("life/disposed", { id: life.id });
          }
        }),
    };
    this.lives.set(life.id, handle);
    this.ctx.emit("life/created", { id: life.id, life });
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

function providerList<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as readonly T[];
  return [value as T];
}

function createWakeEvent(reason: string, data?: unknown): PerceptEvent {
  return {
    id: createId("wake"),
    time: Date.now(),
    bodyId: "life",
    kind: "wake",
    data: { reason, ...(data === undefined ? {} : { data }) },
  };
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
    "life/created"(event: { id: string; life: Life }): void;
    "life/disposed"(event: { id: string }): void;
    "life/error"(event: { id: string; error: unknown }): void;
    "model/changed"(event: { id: string; providerId: string; model: unknown }): void;
    "percept/routed"(event: { id: string; modeId: string; event: PerceptEvent; handled: boolean }): void;
    "percept/rejected"(event: { id: string; modeId?: string; event: PerceptEvent; reason: PerceptRejectReason }): void;
  }
}
