import type { AgentFactory, AgentHandle, CreateAgentInput, ResumeAgentInput } from "@yesimbot/harness-core";

export interface AgentLoopProvider {
  readonly id: string;
  readonly factory: AgentFactory;
}

export interface AgentLoopAccess {
  register(provider: AgentLoopProvider): () => Promise<void>;
  get(id: string): AgentLoopProvider | undefined;
  list(): readonly AgentLoopProvider[];
  create(providerId: string, input: CreateAgentInput): Promise<AgentHandle>;
  resume(providerId: string, input: ResumeAgentInput): Promise<AgentHandle>;
}
