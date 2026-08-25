import type { LifeService } from "@athena-ai/protocol";
import { Context, Service } from "cordis";

/**
 * Life plugin: owns the per-Life identity slot and the one-Cortex binding.
 *
 * `persona` and `memory` were removed together with the `JsonObject` /
 * `JsonValue` / `Persona` types — the protocol package is now purely the
 * Nerve contact surface, and this plugin only implements the remaining
 * `LifeService` contract (`id` + `cortex` + `bind`). Persona / memory will
 * come back as their own model when they are designed.
 */
export class Life extends Service implements LifeService {
  private _cortex: Service | null = null;

  constructor(
    ctx: Context,
    public config: Life.Config,
  ) {
    super(ctx, "life");
  }

  /** Stable identifier for this Life. Config-provided, or `undefined`. */
  get id(): string | undefined {
    return this.config.id;
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
}

export namespace Life {
  export interface Config {
    /** Stable identifier for this Life (e.g. `"alice"`). */
    id?: string;
  }
}
