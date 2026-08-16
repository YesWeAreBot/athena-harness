import { Service } from "cordis";
import type { Context } from "cordis";

import { createId } from "../internal.js";
import type { Mode, ModeContext, ModeHandle, ModeSetupHandle } from "./types.js";

export class ModeRegistry extends Service {
  static provide = "modes";

  private readonly definitions = new Map<string, Mode>();

  private readonly instances = new Map<string, { definitionName: string; handle: ModeHandle }>();

  constructor(ctx: Context) {
    super(ctx, "modes");
    this.ctx.effect(() => async () => {
      await this.stopAll();
    });
  }

  register(mode: Mode): () => Promise<void> {
    if (this.definitions.has(mode.name)) {
      throw new Error(`Mode already registered: ${mode.name}`);
    }
    this.definitions.set(mode.name, mode);
    return this.ctx.effect(() => async () => {
      await this.disposeDefinition(mode.name);
    });
  }

  get(name: string): Mode | undefined {
    return this.definitions.get(name);
  }

  list(): Mode[] {
    return [...this.definitions.values()];
  }

  async create<C = any>(name: string, config: C, context: ModeContext = {}): Promise<ModeHandle> {
    const mode = this.definitions.get(name);
    if (!mode) {
      throw new Error(`Mode not registered: ${name}`);
    }
    const created: ModeSetupHandle = await mode.setup(context, config);
    const memoryProviders =
      created.providers?.memory === undefined ? [] : Array.isArray(created.providers.memory) ? created.providers.memory : [created.providers.memory];
    const disposeMemory: Array<() => void> = [];
    if (memoryProviders.length > 0) {
      if (!context.memory) {
        await created.stop?.();
        await created.dispose?.();
        throw new Error("LifeMemory is not installed");
      }
      try {
        for (const provider of memoryProviders) {
          disposeMemory.push(context.memory.registerProvider(provider));
        }
      } catch (error) {
        for (const dispose of disposeMemory) dispose();
        await created.dispose?.();
        throw error;
      }
    }
    const id = createId("mode");
    const lifeId = context.lifeId;
    let disposed = false;
    const handle: ModeHandle = {
      ...created,
      id,
      name: mode.name,
      capabilities: mode.capabilities,
      hooks: created.hooks,
      providers: created.providers,
      get disposed() {
        return disposed;
      },
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        this.instances.delete(id);
        try {
          await created.stop?.();
        } finally {
          await created.dispose?.();
        }
        for (const dispose of disposeMemory) dispose();
        if (lifeId) {
          for (const provider of providerList(created.providers?.state)) await provider.persist?.(lifeId);
        }
        for (const provider of providerList(created.providers?.scheduler)) provider.cancelAll();
        await Promise.allSettled(
          [
            ...memoryProviders,
            ...providerList(created.providers?.model),
            ...providerList(created.providers?.state),
            ...providerList(created.providers?.delivery),
            ...providerList(created.providers?.media),
            ...providerList(created.providers?.scheduler),
          ].map((provider) => provider.dispose?.()),
        );
        if (lifeId) {
          (this.ctx.get("scheduler") as { cancelByLife(lifeId: string): void } | undefined)?.cancelByLife(lifeId);
        }
        this.ctx.emit("mode/disposed", { id, name: handle.name });
      },
    };
    this.instances.set(id, { definitionName: name, handle });
    return handle;
  }

  async dispose(id: string): Promise<void> {
    await this.instances.get(id)?.handle.dispose?.();
  }

  async stopAll(): Promise<void> {
    const handles = [...this.instances.values()].map((entry) => entry.handle);
    await Promise.allSettled(handles.map((handle) => handle.dispose?.()));
  }

  private async disposeDefinition(name: string): Promise<void> {
    const entries = [...this.instances.values()].filter((entry) => entry.definitionName === name);
    await Promise.allSettled(entries.map((entry) => entry.handle.dispose?.()));
    this.definitions.delete(name);
  }
}

function providerList<T>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value as readonly T[];
  return [value as T];
}

export const modeRegistry = {
  apply(ctx: Context) {
    new ModeRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    modes: ModeRegistry;
  }

  interface Events {
    "mode/disposed"(event: { id: string; name: string }): void;
  }
}
