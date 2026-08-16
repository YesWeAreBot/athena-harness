import type { AgentHandle, CreateAgentOptions, ResumeAgentOptions } from "@athena/agent";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { AgentLoopAccess, AgentLoopProvider } from "./types.js";

export class AgentLoopRegistry extends Service implements AgentLoopAccess {
  static provide = "agentLoop";

  private readonly providers = new Map<string, AgentLoopProvider>();

  constructor(ctx: Context) {
    super(ctx, "agentLoop");
    this.ctx.effect(() => () => {
      this.providers.clear();
    });
  }

  register(provider: AgentLoopProvider): () => Promise<void> {
    if (this.providers.has(provider.id)) {
      throw new Error(`AgentLoop provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
    return this.ctx.effect(() => async () => {
      if (this.providers.get(provider.id) === provider) this.providers.delete(provider.id);
    });
  }

  get(id: string): AgentLoopProvider | undefined {
    return this.providers.get(id);
  }

  list(): readonly AgentLoopProvider[] {
    return [...this.providers.values()];
  }

  async create(providerId: string, input: CreateAgentOptions): Promise<AgentHandle> {
    return this.require(providerId).factory.createAgent(input);
  }

  async resume(providerId: string, input: ResumeAgentOptions): Promise<AgentHandle> {
    return this.require(providerId).factory.resumeAgent(input);
  }

  private require(id: string): AgentLoopProvider {
    const provider = this.providers.get(id);
    if (!provider) {
      throw new Error(`AgentLoop provider not found: ${id}`);
    }
    return provider;
  }
}

export const agentLoopRegistry = {
  apply(ctx: Context) {
    new AgentLoopRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    agentLoop: AgentLoopRegistry;
  }
}

export type { AgentLoopAccess, AgentLoopProvider } from "./types.js";
