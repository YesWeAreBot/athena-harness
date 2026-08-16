import { z } from "zod";

const apiConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
    host: z.string().default("127.0.0.1"),
    port: z.number().int().min(0).max(65535).default(7788),
    token: z.string().optional(),
  })
  .default({});

const consoleConfigSchema = z
  .object({
    enabled: z.boolean().default(true),
  })
  .default({});

const pluginConfigSchema = z.object({
  id: z.string(),
  package: z.string(),
  enabled: z.boolean().default(true),
  config: z.unknown().optional(),
});

const modelProviderConfigSchema = z.object({
  id: z.string(),
  provider: z.string(),
  roles: z.array(z.string()).default([]),
  config: z.record(z.unknown()).default({}),
});

const modeConfigSchema = z.object({
  id: z.string(),
  package: z.string(),
  version: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

const bodyConfigSchema = z.object({
  id: z.string(),
  package: z.string(),
  version: z.string().optional(),
  enabled: z.boolean().default(true),
  config: z.record(z.unknown()).default({}),
});

const lifeConfigSchema = z.object({
  id: z.string(),
  mode: z.string().optional(),
  modelProvider: z.string().optional(),
  bodies: z.array(z.string()).default([]),
});

export const runtimeConfigSchema = z.object({
  runtime: z
    .object({
      name: z.string().default("athena"),
      dataDir: z.string().default("./data"),
    })
    .default({}),
  core: z
    .object({
      persistence: z.enum(["none", "jsonl"]).default("jsonl"),
      agentLoop: z.literal("default").default("default"),
    })
    .default({}),
  plugins: z.array(pluginConfigSchema).default([]),
  modelProviders: z.array(modelProviderConfigSchema).default([]),
  modes: z.array(modeConfigSchema).default([]),
  bodies: z.array(bodyConfigSchema).default([]),
  lives: z.array(lifeConfigSchema).default([]),
  api: apiConfigSchema,
  console: consoleConfigSchema,
});

export type RuntimeConfig = z.infer<typeof runtimeConfigSchema>;
export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type PluginConfig = z.infer<typeof pluginConfigSchema>;
export type ModelProviderConfig = z.infer<typeof modelProviderConfigSchema>;
export type ModeConfig = z.infer<typeof modeConfigSchema>;
export type BodyConfig = z.infer<typeof bodyConfigSchema>;
export type LifeConfig = z.infer<typeof lifeConfigSchema>;
