import { createGoogle } from "@ai-sdk/google";
import type {} from "@athena-ai/ai";
import { Schema } from "@athena-ai/core";
import type { Context } from "cordis";

export const name = "provider-google";

export const inject = ["ai"];

export const reusable = true;

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("google").description("提供商标识（不可与已注册的提供商重复）"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("自定义 API 地址，留空使用官方端点"),
});

/**
 * Registers a bare AI SDK Google provider. Model declarations, metadata, headers and default call
 * settings all live in `models.yml` — this plugin only carries credentials.
 */
export function apply(ctx: Context, config: Config) {
  const provider = createGoogle({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-google(${config.id}).unregister`);
}
