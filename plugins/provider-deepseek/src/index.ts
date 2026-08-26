import { createDeepSeek } from "@ai-sdk/deepseek";
import { Schema } from "@athena-ai/core";
import type { Context } from "cordis";

export const name = "provider-deepseek";
export const inject = ["ai"];
export const reusable = true;

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("deepseek"),
  apiKey: Schema.string().role("secret").required(),
  baseURL: Schema.string().default("https://api.deepseek.com").role("link"),
});

export function apply(ctx: Context, config: Config) {
  const provider = createDeepSeek({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-deepseek(${config.id}).unregister`);
}
