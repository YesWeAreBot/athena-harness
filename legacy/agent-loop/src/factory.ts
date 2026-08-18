import type { AgentFactory, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from "@athena/agent";
import type { Session } from "@athena/session";
import type { Context } from "cordis";

import { ConcreteAgent } from "./agent-impl.js";

export class ReactLoopAgentFactory implements AgentFactory {
  constructor(private ctx: Context) {}

  async createAgent(options: CreateAgentOptions): Promise<AgentHandle> {
    const ownsSession = options.session === undefined;
    const session = options.session ?? this.ctx.sessions.create(options.id ? { id: options.id } : undefined);

    // Acquire persistence binding before setup, so crash during setup doesn't orphan a file
    const binding = options.binding ?? (this.ctx.sessions.persistence ? await this.ctx.sessions.persistence.create(session.header) : undefined);

    const agent = new ConcreteAgent({
      id: session.id,
      session,
      model: options.model,
      maxSteps: options.maxSteps ?? 10,
      ctx: this.ctx,
      binding,
    });

    // Run setup in a child context scoped to this agent
    if (options.setup) {
      const agentCtx = this.ctx.extend({ [agent.agentKey.toString()]: agent });
      await options.setup(agentCtx);
    }

    agent.start();

    return {
      agent,
      dispose: async () => {
        await agent.dispose();
        await binding?.close();
        if (ownsSession) this.ctx.sessions.remove(session.id);
      },
    };
  }

  async resumeAgent(options: ResumeAgentOptions): Promise<AgentHandle> {
    const ownsSession = options.session === undefined;
    let session: Session;
    if (options.session) {
      session = options.session;
    } else {
      const persistence = this.ctx.sessions.persistence;
      if (!persistence) throw new Error("Cannot resume: no persistence handler registered");
      const prepared = await persistence.prepare(options.id);
      session = this.ctx.sessions.restore(prepared.header, prepared.events);
      await prepared.close();
    }

    const binding = options.binding ?? (this.ctx.sessions.persistence ? await this.ctx.sessions.persistence.open(session.id) : undefined);
    const agent = new ConcreteAgent({
      id: session.id,
      session,
      model: options.model,
      maxSteps: options.maxSteps ?? 10,
      ctx: this.ctx,
      binding,
    });

    if (options.setup) {
      const agentCtx = this.ctx.extend({ [agent.agentKey.toString()]: agent });
      await options.setup(agentCtx);
    }

    agent.start();

    return {
      agent,
      dispose: async () => {
        await agent.dispose();
        await binding?.close();
        if (ownsSession) this.ctx.sessions.remove(session.id);
      },
    };
  }
}
