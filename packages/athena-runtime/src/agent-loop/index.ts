import type { AgentHandle, CreateAgentInput, ResumeAgentInput } from "@yesimbot/harness-core";
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

  async create(providerId: string, input: CreateAgentInput): Promise<AgentHandle> {
    return this.require(providerId).factory.create(input);
  }

  async resume(providerId: string, input: ResumeAgentInput): Promise<AgentHandle> {
    return this.require(providerId).factory.resume(input);
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
