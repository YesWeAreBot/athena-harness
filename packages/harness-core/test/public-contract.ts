import type { Agent, Session } from "@yesimbot/harness-core";
import { agentLoop } from "@yesimbot/harness-core/agent-loop";
import { jsonlPersistence } from "@yesimbot/harness-core/persist/jsonl";

export type PublicAgent = Agent;

export type PublicSession = Session;

export const publicProviders = {
  agentLoop,
  jsonlPersistence,
};
