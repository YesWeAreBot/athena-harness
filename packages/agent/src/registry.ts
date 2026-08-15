import { Service } from "cordis";
import type { Context } from "cordis";

import type { Agent, AgentFactory, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from "./types.js";

declare module "cordis" {
  interface Context {
    agents: AgentRegistry;
  }
}

export class AgentRegistry extends Service {
  static provide = "agents";

  private _factory: AgentFactory | undefined;
  private _agents = new Map<string, Agent>();

  constructor(ctx: Context) {
    super(ctx, "agents");
  }

  /**
   * Register the AgentFactory (Loop replacement seam — spec K3).
   * Throws if a factory is already registered.
   * Returns a Cordis-effect cleanup.
   */
  setFactory(factory: AgentFactory): () => void {
    if (this._factory) throw new Error("AgentFactory is already registered");
    this._factory = factory;
    return this.ctx.effect(() => () => {
      if (this._factory === factory) this._factory = undefined;
    });
  }

  async create(options: CreateAgentOptions): Promise<AgentHandle> {
    const handle = await this._requireFactory().createAgent(options);
    this._register(handle);
    return this._wrap(handle);
  }

  async resume(options: ResumeAgentOptions): Promise<AgentHandle> {
    const handle = await this._requireFactory().resumeAgent(options);
    this._register(handle);
    return this._wrap(handle);
  }

  get(id: string): Agent | undefined {
    return this._agents.get(id);
  }

  list(): readonly Agent[] {
    return [...this._agents.values()];
  }

  // ── private ───────────────────────────────────────────────────────────────

  private _requireFactory(): AgentFactory {
    if (!this._factory) throw new Error("No AgentFactory registered");
    return this._factory;
  }

  private _register(handle: AgentHandle): void {
    if (this._agents.has(handle.agent.id)) {
      throw new Error(`Agent already exists: ${handle.agent.id}`);
    }
    this._agents.set(handle.agent.id, handle.agent);
  }

  /** Wraps handle.dispose() to remove from registry. */
  private _wrap(handle: AgentHandle): AgentHandle {
    let disposed = false;
    return {
      agent: handle.agent,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        this._agents.delete(handle.agent.id);
        await handle.dispose();
      },
    };
  }
}
