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

import { DeliveryPolicyRegistry } from "../src/delivery-policy/index.js";
import { DeliveryProviderRegistry } from "../src/delivery-provider/index.js";
import { LifeRegistry } from "../src/life/index.js";
import { ModeRegistry } from "../src/mode/index.js";
import { ModelProviderRegistry } from "../src/model-provider/index.js";
import { StateProviderRegistry } from "../src/state-provider/index.js";

async function setupLife() {
  const ctx = new Context();
  const fibers = await Promise.all([
    ctx.plugin(SessionRegistry),
    ctx.plugin(ToolRegistry),
    ctx.plugin(SystemPrompt),
    ctx.plugin(AgentRegistry),
    ctx.plugin(AgentLoop),
    ctx.plugin(ModeRegistry),
    ctx.plugin(ModelProviderRegistry),
    ctx.plugin(StateProviderRegistry),
    ctx.plugin(DeliveryProviderRegistry),
    ctx.plugin(DeliveryPolicyRegistry),
    ctx.plugin(LifeRegistry),
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
    const fibers = await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(LifeRegistry)]);
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
      ctx.plugin(LifeRegistry),
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

  it("fails over to the next global model provider for a role", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      const first = new MockLanguageModelV4();
      const second = new MockLanguageModelV4();
      let firstCalls = 0;
      const errors: unknown[] = [];
      ctx.on("model/error", (event) => errors.push(event));
      ctx.modelProviders.register({
        id: "main-a",
        roles: ["main"] as const,
        get: async () => {
          firstCalls++;
          throw new Error("provider a failed");
        },
      });
      ctx.modelProviders.register({
        id: "main-b",
        roles: ["main"] as const,
        get: async () => second,
      });

      const handle = await ctx.lives.createWithAgent({
        id: "life-model-failover",
        agentLoop: { model: first, maxSteps: 1 },
      });
      await handle.setModelByRole("main");

      expect(firstCalls).toBe(1);
      expect(handle.agent?.model).toBe(second);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ id: "life-model-failover", providerId: "main-a", role: "main" });
      await handle.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("falls back to global state and delivery providers", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      let stateValue = "s1";
      let delivered = false;
      let deliveredB = false;
      ctx.stateProviders.register({
        id: "global-state",
        kinds: ["story"] as const,
        get: async () => stateValue,
        set: async (next: unknown) => {
          stateValue = next as string;
        },
      });
      ctx.deliveryProviders.register({
        id: "global-delivery",
        kinds: ["message"] as const,
        canDeliver: (target: unknown) => (target as { channel?: string }).channel === "a",
        deliver: async () => {
          delivered = true;
          return { id: "delivery-1", status: "delivered" as const };
        },
        schedule: async () => {
          return { id: "delivery-2", status: "delayed" as const, scheduledAt: Date.now() + 1000 };
        },
        cancel: async () => {
          return true;
        },
      });
      ctx.deliveryProviders.register({
        id: "global-delivery-b",
        kinds: ["message"] as const,
        canDeliver: (target: unknown) => (target as { channel?: string }).channel === "b",
        deliver: async () => {
          deliveredB = true;
          return { id: "delivery-b", status: "delivered" as const };
        },
        schedule: async () => {
          return { id: "delivery-b-delayed", status: "delayed" as const, scheduledAt: Date.now() + 1000 };
        },
        cancel: async () => {
          return true;
        },
      });

      const handle = await ctx.lives.createWithAgent({
        id: "life-global-providers",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });
      await expect(handle.getState("global-state")).resolves.toBe("s1");
      await handle.setState("global-state", "s2");
      expect(stateValue).toBe("s2");
      await expect(handle.deliver("message", { channel: "a" }, {})).resolves.toMatchObject({ status: "delivered" });
      await expect(handle.deliver("message", { channel: "b" }, {})).resolves.toMatchObject({ status: "delivered" });
      await expect(handle.scheduleDelivery({ kind: "message", target: { channel: "a" }, payload: {}, at: Date.now() + 1000 })).resolves.toMatchObject({
        status: "delayed",
      });
      await expect(handle.cancelDelivery("delivery-2")).resolves.toBe(true);
      expect(delivered).toBe(true);
      expect(deliveredB).toBe(true);

      await handle.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("enforces global delivery policy before routing", async () => {
    const { ctx, fibers } = await setupLife();
    try {
      ctx.deliveryPolicies.register("block-b", ({ target }) => (target as { channel?: string }).channel !== "blocked");
      ctx.deliveryProviders.register({
        id: "global-delivery",
        kinds: ["message"] as const,
        deliver: async () => ({ id: "delivery-1", status: "delivered" as const }),
      });

      const handle = await ctx.lives.createWithAgent({
        id: "life-delivery-policy",
        agentLoop: { model: new MockLanguageModelV4(), maxSteps: 1 },
      });
      await expect(handle.deliver("message", { channel: "blocked" }, {})).rejects.toThrow(/Delivery policy rejected/);
      await expect(handle.deliver("message", { channel: "ok" }, {})).resolves.toMatchObject({ status: "delivered" });

      await handle.dispose();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
