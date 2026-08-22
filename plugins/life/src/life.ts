import type { LifeService, MemoryProvider, MemoryEntry, MemoryValue, Persona, SearchOptions } from "@athena-ai/protocol";
import { Context, Service } from "cordis";

function isPersona(input: string | Persona): input is Persona {
  return typeof input === "object";
}

// In-memory stub for v1
class MemoryStub implements MemoryProvider {
  private _store = new Map<string, MemoryValue>();

  async store(key: string, value: MemoryValue): Promise<void> {
    this._store.set(key, value);
  }

  async retrieve(key: string): Promise<MemoryValue | null> {
    return this._store.get(key) ?? null;
  }

  async search(_query: string, _options?: SearchOptions): Promise<MemoryEntry[]> {
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
  /** The Cortex currently bound, or `null` while none is bound. */
  get cortex(): Service | null {
    return this._cortex;
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
    if (isPersona(input)) return input;
    // v1: only inline object supported; file loading deferred
    throw new Error(`Persona file loading not yet implemented: ${input}`);
  }
}

export namespace Life {
  export interface Config {
    persona: string | Persona;
  }
}
