import { Service } from "cordis";
import type { Context } from "cordis";

import type { ModeDeliveryPermission, ModeDeliveryPolicy } from "../mode/types.js";
declare module "cordis" {
  interface Context {
    deliveryPolicies: DeliveryPolicyRegistry;
  }
}
export class DeliveryPolicyRegistry extends Service {
  private readonly policies = new Map<string, ModeDeliveryPolicy>();

  constructor(ctx: Context) {
    super(ctx, "deliveryPolicies");
    this.ctx.effect(() => () => {
      this.policies.clear();
    });
  }

  register(name: string, policy: ModeDeliveryPolicy): () => void {
    if (this.policies.has(name)) {
      throw new Error(`Delivery policy already registered: ${name}`);
    }
    this.policies.set(name, policy);
    return this.ctx.effect(() => () => {
      if (this.policies.get(name) === policy) this.policies.delete(name);
    });
  }

  unregister(name: string): boolean {
    return this.policies.delete(name);
  }

  list(): readonly string[] {
    return [...this.policies.keys()];
  }

  allow(permission: ModeDeliveryPermission): boolean {
    return [...this.policies.values()].every((policy) => policy(permission));
  }
}

export type { ModeDeliveryPermission, ModeDeliveryPolicy } from "../mode/types.js";
