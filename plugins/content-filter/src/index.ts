import { Schema } from "@athena-ai/core";
import type { CortexAction, CortexEnactVerdict } from "@athena-ai/protocol";
import type { Context } from "cordis";

export const name = "content-filter";

export const inject = [];

export interface Config {
  blocked: string[];
}

export const Config: Schema<Config> = Schema.object({
  blocked: Schema.array(Schema.string()).default([]).description("Action text containing any of these values will be vetoed"),
});

/**
 * Reference guard plugin for the Cortex Hook Protocol.
 *
 * It listens to `cortex/before-enact` and returns a structured
 * `CortexEnactVerdict` when the action text matches a configured term.
 * Cortexes that do not emit the hook are unaffected.
 */
export function apply(ctx: Context, config: Config) {
  ctx.on("cortex/before-enact", (action: CortexAction): CortexEnactVerdict | void => {
    const text = action.text ?? action.data?.content;
    if (!text) return;
    const normalized = text.toLowerCase();
    if (!config.blocked.some((term) => normalized.includes(term.toLowerCase()))) return;
    return {
      vetoed: true,
      reason: `content-filter blocked "${action.type}" (${action.id})`,
    };
  });
}
