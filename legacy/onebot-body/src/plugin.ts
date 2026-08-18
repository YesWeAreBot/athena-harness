import type { Context, Plugin } from "cordis";

import { OneBotBodyAdapter } from "./body.js";
import type { OneBotConfig } from "./config.js";
import { resolveOneBotConfig } from "./config.js";

export function onebotBody(config: OneBotConfig): Plugin {
  const resolved = resolveOneBotConfig(config);
  return {
    name: `onebot-body:${resolved.id}`,
    inject: ["bodies"] as const,
    apply(ctx: Context) {
      const adapter = new OneBotBodyAdapter(resolved);
      return ctx.effect(() => ctx.bodies.registerAdapter(adapter));
    },
  };
}
