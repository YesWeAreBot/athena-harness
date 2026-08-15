import { Service } from "cordis";
import type { Context } from "cordis";

import type { Agent, AgentFactory, AgentHandle, CreateAgentInput, ResumeAgentInput } from "./types.js";

export class AgentRegistry extends Service {
  static provide = "agents";

  private factory?: AgentFactory;

  private handles = new Map<string, AgentHandle>();

  constructor(ctx: Context) {
    super(ctx, "agents");
  }

  setFactory(factory: AgentFactory): () => Promise<void> {
    if (this.factory) {
      throw new Error("AgentFactory is already registered");
    }
    this.factory = factory;
    return this.ctx.effect(() => () => {
      if (this.factory === factory) this.factory = undefined;
    });
  }

  async create(input: CreateAgentInput): Promise<AgentHandle> {
    return this.register(await this.requireFactory().create(input));
  }

  async resume(input: ResumeAgentInput): Promise<AgentHandle> {
    return this.register(await this.requireFactory().resume(input));
  }

  get(id: string): Agent | undefined {
    return this.handles.get(id)?.agent;
  }

  list(): Agent[] {
    return [...this.handles.values()].map((handle) => handle.agent);
  }

  async dispose(id: string): Promise<void> {
    const handle = this.handles.get(id);
    if (handle) await handle.dispose();
  }

  private requireFactory(): AgentFactory {
    if (!this.factory) {
      throw new Error("No AgentFactory registered");
    }
    return this.factory;
  }

  private register(handle: AgentHandle): AgentHandle {
    if (this.handles.has(handle.agent.id)) {
      throw new Error(`Agent already exists: ${handle.agent.id}`);
    }

    let disposed = false;
    const originalDispose = handle.dispose;
    const registered: AgentHandle = {
      agent: handle.agent,
      dispose: async () => {
        if (disposed) return;
        disposed = true;
        this.handles.delete(handle.agent.id);
        await originalDispose.call(handle);
      },
    };
    this.handles.set(handle.agent.id, registered);
    return registered;
  }
}

export const agentRegistry = {
  inject: ["sessions"] as const,
  apply(ctx: Context) {
    new AgentRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    agents: AgentRegistry;
  }
}
