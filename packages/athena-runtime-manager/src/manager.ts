import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import { AgentRegistry } from "@athena/agent";
import { AgentLoop } from "@athena/agent-loop";
import { PersistJsonl } from "@athena/persist-jsonl";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import type { RuntimeConfig } from "@yesimbot/athena-config";
import { loadBodyPackage, loadModePackage } from "@yesimbot/athena-loader";
import {
  agentLoopRegistry,
  bodyRegistry,
  deliveryPolicyRegistry,
  deliveryProviderRegistry,
  lifeRegistry,
  memoryRegistry,
  modePipelineRegistry,
  modeRegistry,
  modelProviderRegistry,
  schedulerRegistry,
  stateProviderRegistry,
  type BodyAdapter,
  type Mode,
  type ModePipeline,
} from "@yesimbot/athena-runtime";
import { Context, type Fiber, type Plugin } from "cordis";

import { createEchoMode, createEchoPipeline, createManualBodyAdapter } from "./builtins.js";

export interface RuntimeManagerOptions {
  readonly modePackages?: Readonly<Record<string, Mode>>;
  readonly bodyPackages?: Readonly<Record<string, (config: Record<string, unknown>) => BodyAdapter>>;
  readonly pipelinePackages?: Readonly<Record<string, ModePipeline>>;
}

export interface LifeInput {
  readonly id: string;
  readonly mode?: string;
  readonly bodies?: readonly string[];
}

export class RuntimeManager {
  private ctx: Context | undefined;
  private fibers: Fiber[] = [];

  constructor(
    private readonly config: RuntimeConfig,
    private readonly options: RuntimeManagerOptions = {},
  ) {}

  get context(): Context {
    if (!this.ctx) throw new Error("RuntimeManager is not started");
    return this.ctx;
  }

  async start(): Promise<void> {
    if (this.ctx) return;
    const ctx = new Context();
    const dataDir = this.config.runtime.dataDir;
    await Promise.all([mkdir(join(dataDir, "sessions"), { recursive: true }), mkdir(join(dataDir, "memory"), { recursive: true }), mkdir(join(dataDir, "media"), { recursive: true }), mkdir(join(dataDir, "deliveries"), { recursive: true })]);

    const plugins: Plugin[] = [
      SessionRegistry,
      ToolRegistry,
      SystemPrompt,
      AgentRegistry,
      AgentLoop,
      agentLoopRegistry,
      bodyRegistry,
      modeRegistry,
      memoryRegistry,
      schedulerRegistry,
      modelProviderRegistry,
      stateProviderRegistry,
      deliveryProviderRegistry,
      deliveryPolicyRegistry,
      modePipelineRegistry,
      lifeRegistry,
    ];
    if (this.config.core.persistence === "jsonl") {
      plugins.push(PersistJsonl({ dir: join(dataDir, "sessions") }));
    }

    this.fibers = await Promise.all(plugins.map((plugin) => ctx.plugin(plugin)));
    this.ctx = ctx;

    await this.installModes();
    await this.installBodies();
    await this.reconcileLives();
  }

  async dispose(): Promise<void> {
    if (!this.ctx) return;
    await Promise.allSettled([...this.fibers].reverse().map((fiber) => fiber.dispose()));
    this.ctx = undefined;
    this.fibers = [];
  }

  status() {
    return {
      name: this.config.runtime.name,
      lives: this.listLives(),
      bodies: this.listBodies(),
      modes: this.listModes(),
      pipelines: this.listPipelines(),
    };
  }

  listLives() {
    return this.context.lives.list().map((life) => ({
      id: life.id,
      activeModeId: life.activeModeId,
      bodyIds: life.bodyIds,
      disposed: life.disposed,
    }));
  }

  async createLife(input: LifeInput): Promise<{ id: string; activeModeId?: string; bodyIds: string[]; disposed: boolean }> {
    const handle = this.context.lives.create({ id: input.id });
    for (const bodyId of input.bodies ?? []) await handle.attachBody(bodyId);
    if (input.mode) {
      const mode = await this.context.modes.create(input.mode, {});
      await handle.setMode(mode);
    }
    return {
      id: handle.life.id,
      activeModeId: handle.activeModeId,
      bodyIds: [...handle.life.bodyIds],
      disposed: handle.disposed,
    };
  }

  async removeLife(id: string): Promise<boolean> {
    const handle = this.context.lives.get(id);
    if (!handle) return false;
    await this.context.lives.dispose(id);
    return true;
  }

  listBodies() {
    return this.context.bodies.list().map((body) => ({
      id: body.id,
      name: body.name,
      state: body.state,
      actuators: body.actuators?.map((actuator) => actuator.id),
    }));
  }

  listModes() {
    return this.context.modes.list().map((mode) => ({ name: mode.name, description: mode.description }));
  }

  listPipelines() {
    return this.context.modePipelines.list().map((pipeline) => ({
      id: pipeline.id,
      trigger: pipeline.trigger.kinds,
      execution: pipeline.execution.kind,
    }));
  }

  private async installModes(): Promise<void> {
    for (const modeConfig of this.config.modes) {
      if (!modeConfig.enabled) continue;
      const loaded =
        modeConfig.package === "builtin:echo"
          ? { mode: createEchoMode(), pipeline: createEchoPipeline() }
          : this.options.modePackages?.[modeConfig.package]
            ? { mode: this.options.modePackages[modeConfig.package] }
            : await loadModePackage(modeConfig.package, modeConfig.config);
      if (loaded.pipeline) this.context.modePipelines.register(loaded.pipeline);
      if (loaded.mode) {
        this.context.modes.register(loaded.mode);
        continue;
      }
    }
  }

  private async installBodies(): Promise<void> {
    for (const bodyConfig of this.config.bodies) {
      if (!bodyConfig.enabled) continue;
      const createAdapter =
        bodyConfig.package === "builtin:manual"
          ? (config: Record<string, unknown>) => createManualBodyAdapter({ ...config, id: bodyConfig.id })
          : this.options.bodyPackages?.[bodyConfig.package] ?? (await loadBodyPackage(bodyConfig.package, bodyConfig.config)).createAdapter;
      if (createAdapter) await this.context.bodies.registerAdapter(createAdapter(bodyConfig.config));
    }
  }

  private async reconcileLives(): Promise<void> {
    for (const lifeConfig of this.config.lives) {
      if (this.context.lives.get(lifeConfig.id)) continue;
      await this.createLife(lifeConfig);
    }
  }

}
