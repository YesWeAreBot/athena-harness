import { Service } from "cordis";
import type { Context } from "cordis";

import type { Mode, ModeHandle } from "./types.js";

export class ModeRegistry extends Service {
  static provide = "modes";

  private modes = new Map<string, Mode>();

  constructor(ctx: Context) {
    super(ctx, "modes");
  }

  register(mode: Mode): () => Promise<void> {
    if (this.modes.has(mode.name)) {
      throw new Error(`Mode already registered: ${mode.name}`);
    }
    this.modes.set(mode.name, mode);
    return this.ctx.effect(() => () => {
      this.modes.delete(mode.name);
    });
  }

  get(name: string): Mode | undefined {
    return this.modes.get(name);
  }

  list(): Mode[] {
    return [...this.modes.values()];
  }

  async create<C = any>(name: string, config: C): Promise<ModeHandle> {
    const mode = this.modes.get(name);
    if (!mode) {
      throw new Error(`Mode not registered: ${name}`);
    }
    return mode.setup({}, config);
  }
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
}
