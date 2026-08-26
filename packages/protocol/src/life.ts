import { Service } from "cordis";

abstract class LifeService extends Service<LifeService.Config> {
  public static readonly inject = [];
  public abstract id: string;
  public abstract persona: string;
  public abstract cortex: Service | null;

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
    persona: string;
  }
}

export { LifeService };
