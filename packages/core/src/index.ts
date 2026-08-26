import { AIService } from "@athena-ai/ai";
import { NerveService } from "@athena-ai/protocol";
import { Context } from "cordis";

export function apply(ctx: Context) {
  ctx.plugin(NerveService);
  ctx.plugin(AIService);
}

export * from "@athena-ai/ai";
export * from "@athena-ai/protocol";
export * from "cordis";
export * from "cosmokit";
export { default as Schema } from "schemastery";
