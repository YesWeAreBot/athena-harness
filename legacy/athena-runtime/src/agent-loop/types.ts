import type { AgentFactory, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from "@athena/agent";

/**
 * @experimental AgentLoop provider slot.
 */
export interface AgentLoopProvider {
  readonly id: string;
  readonly factory: AgentFactory;
}

export interface AgentLoopAccess {
  register(provider: AgentLoopProvider): () => Promise<void>;
  get(id: string): AgentLoopProvider | undefined;
  list(): readonly AgentLoopProvider[];
  create(providerId: string, input: CreateAgentOptions): Promise<AgentHandle>;
  resume(providerId: string, input: ResumeAgentOptions): Promise<AgentHandle>;
}
