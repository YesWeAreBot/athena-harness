import { Service } from "cordis";
import type { Context } from "cordis";

import type { ModeStateProvider } from "../mode/types.js";

declare module "cordis" {
  interface Context {
    stateProviders: StateProviderRegistry;
  }
}

export class StateProviderRegistry extends Service {
  static provide = "stateProviders";

  private readonly providers = new Map<string, ModeStateProvider>();

  constructor(ctx: Context) {
    super(ctx, "stateProviders");
    this.ctx.effect(() => () => {
      this.providers.clear();
    });
  }

  register(provider: ModeStateProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`State provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this.ctx.effect(() => () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    });
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  get(id: string): ModeStateProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly ModeStateProvider[] {
    return [...this.providers.values()];
  }
}

export * from "./jsonl.js";

export type { ModeStateProvider } from "../mode/types.js";
