import { NerveService } from "@athena-ai/protocol";
import { Context } from "cordis";

export function apply(ctx: Context) {
  ctx.plugin(NerveService);
}

export * from "@athena-ai/protocol";
export * from "cordis";
export * from "cosmokit";
export { default as Schema } from "schemastery";
