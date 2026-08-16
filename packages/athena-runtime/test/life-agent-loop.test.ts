import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { AgentRegistry } from "@athena/agent";
import { AgentLoop } from "@athena/agent-loop";
import { PersistJsonl } from "@athena/persist-jsonl";
import { SystemPrompt } from "@athena/prompt";
import { SessionRegistry } from "@athena/session";
import { ToolRegistry } from "@athena/tools";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { lifeRegistry } from "../src/life/index.js";
import { modeRegistry } from "../src/mode/index.js";

async function setupLife() {
  const ctx = new Context();
  const fibers = await Promise.all([
    ctx.plugin(SessionRegistry),
    ctx.plugin(ToolRegistry),
    ctx.plugin(SystemPrompt),
    ctx.plugin(AgentRegistry),
    ctx.plugin(AgentLoop),
    ctx.plugin(modeRegistry),
    ctx.plugin(lifeRegistry),
  ]);
  return { ctx, fibers };
}

describe("life agent-loop wiring", () => {
  it("creates a Life and binds the canonical AgentLoop Session", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      const handle = await ctx.lives.createWithAgent({
        id: "life-agent-create",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });

      expect(handle.agent).toBeDefined();
      expect(handle.life.agent).toBe(handle.agent);
      expect(handle.life.session).toBe(handle.agent!.session);

      await handle.dispose();
      expect(ctx.lives.get("life-agent-create")).toBeUndefined();
      expect(ctx.agents.get("life-agent-create")).toBeUndefined();
      expect(ctx.sessions.get("life-agent-create")).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("resumes a Life from an existing in-memory Session", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      const session = ctx.sessions.create({ id: "life-agent-resume" });
      const handle = await ctx.lives.resumeWithAgent({
        id: "life-agent-resume",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });

      expect(handle.life.session).toBe(session);
      expect(handle.agent?.session).toBe(session);

      await handle.dispose();
      expect(ctx.sessions.get("life-agent-resume")).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("rolls back Session when AgentLoop is not installed", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(lifeRegistry)]);
    try {
      await expect(
        ctx.lives.createWithAgent({
          id: "life-agent-no-loop",
          agentLoop: { model: new MockLanguageModelV4() },
        }),
      ).rejects.toThrow(/AgentRegistry is not installed/);
      expect(ctx.lives.get("life-agent-no-loop")).toBeUndefined();
      expect(ctx.sessions.get("life-agent-no-loop")).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("creates and resumes a persisted Life agent Session", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-life-agent-"));
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(ToolRegistry),
      ctx.plugin(SystemPrompt),
      ctx.plugin(AgentRegistry),
      ctx.plugin(AgentLoop),
      ctx.plugin(PersistJsonl({ dir: root })),
      ctx.plugin(lifeRegistry),
    ]);
    try {
      const handle = await ctx.lives.createWithAgent({
        id: "life-agent-persist",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });
      await handle.dispose();

      const prepared = await ctx.sessions.persistence!.prepare("life-agent-persist");
      expect(prepared.header.id).toBe("life-agent-persist");
      await prepared.close();

      const resumed = await ctx.lives.resumeWithAgent({
        id: "life-agent-persist",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });
      expect(resumed.agent?.session.id).toBe("life-agent-persist");
      await resumed.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("passes the Life-owned Agent into ModeContext", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      let captured: unknown;
      ctx.modes.register({
        name: "chat",
        setup: async (modeCtx) => {
          captured = modeCtx;
          return {};
        },
      });

      const handle = await ctx.lives.createWithAgent({
        id: "life-agent-mode",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });
      await handle.createMode("chat", {});

      const modeCtx = captured as { agent?: unknown; session?: unknown };
      expect(modeCtx.agent).toBe(handle.agent);
      expect(modeCtx.session).toBe(handle.life.session);

      await handle.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("switches Life Agent model through Mode model provider", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      const first = new MockLanguageModelV4();
      const second = new MockLanguageModelV4();
      const changed: unknown[] = [];
      ctx.on("model/changed", (event) => changed.push(event));
      ctx.modes.register({
        name: "model-mode",
        setup: async () => ({
          providers: {
            model: {
              id: "main",
              roles: ["main"] as const,
              get: async () => second,
            },
          },
        }),
      });

      const handle = await ctx.lives.createWithAgent({
        id: "life-model",
        agentLoop: { model: first, maxSteps: 1 },
      });
      await handle.createMode("model-mode", {});
      expect(handle.agent?.model).toBe(first);

      await handle.setModel("main");
      expect(handle.agent?.model).toBe(second);
      expect(changed).toHaveLength(1);
      expect(changed[0]).toMatchObject({ id: "life-model", providerId: "main" });

      await handle.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
