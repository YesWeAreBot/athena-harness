import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { LanguageModel } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentRegistry } from "../src/agent/index.js";
import type { Agent, AgentFactory } from "../src/agent/types.js";
import type { PersistenceSessionBinding } from "../src/persist/index.js";
import { jsonlPersistence } from "../src/persist/jsonl.js";
import { Session, sessionStore } from "../src/session/index.js";

describe("agent multi-session persistence", () => {
  it("persists, restores, and disposes an agent with multiple sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [ctx.plugin(sessionStore), ctx.plugin(agentRegistry), ctx.plugin(jsonlPersistence, { root })];
    await Promise.all(fibers);

    let initialPrimary: Session | undefined;
    let initialSecondary: Session | undefined;
    const factory: AgentFactory = {
      create: async () => {
        const primary = ctx.sessions.create({ id: "multi-primary" });
        const secondary = ctx.sessions.create({ id: "multi-secondary" });
        const primaryBinding = await ctx.persist.create(primary.header);
        const secondaryBinding = await ctx.persist.create(secondary.header);
        primary.append("user/message", { content: "primary" }, { surfaceOp: "append" });
        secondary.append("user/message", { content: "secondary" }, { surfaceOp: "append" });
        primaryBinding.append(primary.snapshotEvents);
        secondaryBinding.append(secondary.snapshotEvents);
        await Promise.all([primaryBinding.flush(), secondaryBinding.flush()]);
        initialPrimary = primary;
        initialSecondary = secondary;
        return createMultiHandle(ctx, primary, secondary, primaryBinding, secondaryBinding);
      },
      resume: async () => {
        const preparedPrimary = await ctx.persist.prepare("multi-primary");
        const preparedSecondary = await ctx.persist.prepare("multi-secondary");
        const primary = ctx.sessions.restore(preparedPrimary.header, preparedPrimary.events);
        const secondary = ctx.sessions.restore(preparedSecondary.header, preparedSecondary.events);
        await preparedPrimary.close();
        await preparedSecondary.close();
        const primaryBinding = await ctx.persist.open("multi-primary");
        const secondaryBinding = await ctx.persist.open("multi-secondary");
        return createMultiHandle(ctx, primary, secondary, primaryBinding, secondaryBinding);
      },
    };
    ctx.agents.setFactory(factory);

    try {
      const first = await ctx.agents.create({
        id: "multi-primary",
        model: {} as LanguageModel,
        maxSteps: 1,
      });
      expect(first.agent.sessions).toHaveLength(2);
      expect(first.agent.getSession("multi-secondary")).toBeDefined();
      await ctx.agents.dispose(first.agent.id);
      expect(ctx.sessions.get("multi-primary")).toBeUndefined();
      expect(ctx.sessions.get("multi-secondary")).toBeUndefined();

      const resumed = await ctx.agents.resume({
        id: "multi-primary",
        model: {} as LanguageModel,
        maxSteps: 1,
      });
      expect(resumed.agent.primarySession.snapshotEvents).toEqual(initialPrimary!.snapshotEvents);
      expect(resumed.agent.getSession("multi-secondary")!.snapshotEvents).toEqual(initialSecondary!.snapshotEvents);
      await ctx.agents.dispose(resumed.agent.id);
      expect(ctx.sessions.get("multi-secondary")).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createMultiHandle(
  ctx: Context,
  primary: Session,
  secondary: Session,
  primaryBinding: PersistenceSessionBinding,
  secondaryBinding: PersistenceSessionBinding,
) {
  const agent: Agent = {
    id: primary.id,
    primarySession: primary,
    sessions: [primary, secondary],
    getSession: (id) => (id === primary.id ? primary : id === secondary.id ? secondary : undefined),
    model: {} as LanguageModel,
    maxSteps: 1,
    status: "idle",
    send() {},
    cancel() {},
    whenIdle: () => Promise.resolve(),
  };
  return {
    agent,
    dispose: async () => {
      await Promise.all([primaryBinding.close(), secondaryBinding.close()]);
      ctx.sessions.remove(primary.id);
      ctx.sessions.remove(secondary.id);
    },
  };
}
