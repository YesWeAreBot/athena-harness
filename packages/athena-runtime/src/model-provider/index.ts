import { Service } from "cordis";
import type { Context } from "cordis";

import type { ModeModelProvider, ModeModelRole } from "../mode/types.js";

export class ModelProviderRegistry extends Service {
  static provide = "modelProviders";

  private readonly providers = new Map<string, ModeModelProvider>();

  constructor(ctx: Context) {
    super(ctx, "modelProviders");
    this.ctx.effect(() => () => {
      this.providers.clear();
    });
  }

  register(provider: ModeModelProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Model provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this.ctx.effect(() => () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    });
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  get(id: string): ModeModelProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly ModeModelProvider[] {
    return [...this.providers.values()];
  }

  resolve(role: ModeModelRole): ModeModelProvider | undefined {
    return this.list().find((provider) => provider.roles.includes(role));
  }

  resolveAll(role: ModeModelRole): readonly ModeModelProvider[] {
    return this.list().filter((provider) => provider.roles.includes(role));
  }
}

export const modelProviderRegistry = {
  apply(ctx: Context) {
    new ModelProviderRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    modelProviders: ModelProviderRegistry;
  }
}

export type { ModeModelProvider, ModeModelRole } from "../mode/types.js";
