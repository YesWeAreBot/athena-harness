import { Context, Service } from "cordis";

import { NerveService } from "./nerve.js";

abstract class LifeService extends Service<LifeService.Config> {
  public static readonly inject = [];
  public abstract id: string;
  public abstract dataDir: string;
  public abstract persona: string;
  public abstract cortex: Service | null;

  constructor(ctx: Context, name: string) {
    super(ctx, name);
    if (ctx.get("nerve")) {
      throw new Error('service "nerve" has been registered in this domain; each Life must isolate "nerve"');
    }
    ctx.plugin(NerveService);
  }

  bind(cortex: Service): () => void {
    if (this.cortex) {
      throw new Error(`Only one Cortex per Life. Current: ${this.cortex.name}, attempted: ${cortex.name}`);
    }
    this.cortex = cortex;
    const name = cortex.name;
    return () => {
      if (this.cortex && this.cortex.name === name) {
        this.cortex = null;
      }
    };
  }
}

namespace LifeService {
  export interface Config {
    id: string;
    dataDir?: string;
    persona: string;
  }
}

export { LifeService };
