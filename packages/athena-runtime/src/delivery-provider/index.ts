import { Service } from "cordis";
import type { Context } from "cordis";

import type { ModeDeliveryKind, ModeDeliveryProvider } from "../mode/types.js";

declare module "cordis" {
  interface Context {
    deliveryProviders: DeliveryProviderRegistry;
  }
}

export class DeliveryProviderRegistry extends Service {
  static provide = "deliveryProviders";

  private readonly providers = new Map<string, ModeDeliveryProvider>();

  constructor(ctx: Context) {
    super(ctx, "deliveryProviders");
    this.ctx.effect(() => () => {
      this.providers.clear();
    });
  }

  register(provider: ModeDeliveryProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new Error(`Delivery provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this.ctx.effect(() => () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    });
  }

  unregister(id: string): boolean {
    return this.providers.delete(id);
  }

  resolve(kind: ModeDeliveryKind, target?: unknown): ModeDeliveryProvider | undefined {
    return this.resolveAll(kind, target)[0];
  }

  resolveAll(kind: ModeDeliveryKind, target?: unknown): readonly ModeDeliveryProvider[] {
    return this.list().filter((provider) => provider.kinds.includes(kind) && (!provider.canDeliver || provider.canDeliver(target)));
  }

  list(): readonly ModeDeliveryProvider[] {
    return [...this.providers.values()];
  }
}

export type { ModeDeliveryKind, ModeDeliveryProvider } from "../mode/types.js";
