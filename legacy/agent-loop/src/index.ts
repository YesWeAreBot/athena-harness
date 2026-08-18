import "@athena/agent";
import "@athena/prompt";
import "@athena/session";
import "@athena/tools";
import type { Context } from "cordis";

import { ReactLoopAgentFactory } from "./factory.js";

export const AgentLoop = {
  inject: ["agents", "sessions", "tools", "systemPrompt"] as const,
  apply(ctx: Context) {
    return ctx.agents.setFactory(new ReactLoopAgentFactory(ctx));
  },
};

export { ConcreteAgent } from "./agent-impl.js";
export { runTurn } from "./turn-runner.js";
export { ReactLoopAgentFactory } from "./factory.js";
