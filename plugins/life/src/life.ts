import type { LifeService, MemoryProvider, MemoryEntry, Persona } from "@athena-ai/protocol";
import { Context, Service } from "cordis";

// In-memory stub for v1
class MemoryStub implements MemoryProvider {
  private _store = new Map<string, unknown>();

  async store(key: string, value: unknown): Promise<void> {
    this._store.set(key, value);
  }

  async retrieve(key: string): Promise<unknown> {
    return this._store.get(key) ?? null;
  }

  async search(_query: string, _options?: unknown): Promise<MemoryEntry[]> {
    return [];
  }
}

export class Life extends Service implements LifeService {
  public persona: Persona;
  public memory: MemoryProvider;
  private _cortex: Service | null = null;

  constructor(
    ctx: Context,
    public config: Life.Config,
  ) {
    super(ctx, "life");
    this.persona = this._resolvePersona(config.persona);
    this.memory = new MemoryStub();
  }

  bind(cortex: Service): () => void {
    if (this._cortex) {
      throw new Error(`Only one Cortex per Life. Current: ${this._cortex.name}, attempted: ${cortex.name}`);
    }
    this._cortex = cortex;
    const name = cortex.name;
    return () => {
      if (this._cortex && this._cortex.name === name) {
        this._cortex = null;
      }
    };
  }

  private _resolvePersona(input: string | Persona): Persona {
    if (typeof input === "object") return input;
    // v1: only inline object supported; file loading deferred
    throw new Error(`Persona file loading not yet implemented: ${input}`);
  }
}

export namespace Life {
  export interface Config {
    persona: string | Persona;
  }
}
