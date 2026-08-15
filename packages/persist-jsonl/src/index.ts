import type { Context } from "cordis";
import { JsonlHandler } from "./handler.js";

export interface PersistJsonlConfig {
  /** Directory where `{id}.jsonl` files are stored. Must already exist. */
  dir: string;
}

export const persistJsonl = (config: PersistJsonlConfig) => ({
  inject: ["sessions"] as const,
  apply(ctx: Context) {
    ctx.sessions.setPersistence(new JsonlHandler(config));
  },
});

export { JsonlHandler }     from "./handler.js";
export { JsonlSessionBinding } from "./binding.js";
