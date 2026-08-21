import { createOpenAI } from "@ai-sdk/openai";
import type {} from "@athena-ai/ai";
import { Schema } from "@athena-ai/core";
import type { Context } from "cordis";

export const name = "provider-openai";

export const inject = ["ai"];

/** Installable more than once: an official key plus an OpenAI-compatible gateway is a normal setup. */
export const reusable = true;

export interface Config {
  id: string;
  apiKey: string;
  baseURL?: string;
}

export const Config: Schema<Config> = Schema.object({
  id: Schema.string().default("openai").description("提供商标识（不可与已注册的提供商重复）"),
  apiKey: Schema.string().role("secret").required().description("API Key"),
  baseURL: Schema.string().description("自定义 API 地址，留空使用官方端点"),
});

/**
 * Registers a bare AI SDK OpenAI provider. Model declarations, metadata, headers and default call
 * settings all live in `models.yml` — this plugin only carries credentials.
 */
export function apply(ctx: Context, config: Config) {
  const provider = createOpenAI({ apiKey: config.apiKey, baseURL: config.baseURL });
  const dispose = ctx.ai.register(config.id, provider);
  ctx.effect(() => dispose, `provider-openai(${config.id}).unregister`);
}
