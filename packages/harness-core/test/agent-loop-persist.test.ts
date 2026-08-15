import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Tool } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { agentLoop } from "../src/agent-loop/index.js";
import type { AgentContext } from "../src/agent/context.js";
import { agentRegistry } from "../src/agent/index.js";
import { modelSurface } from "../src/model-surface.js";
import { jsonlPersistence } from "../src/persist/jsonl.js";
import { sessionStore } from "../src/session/index.js";
import { systemPrompt } from "../src/system-prompt.js";
import { toolRuntime } from "../src/tools.js";

function createMockModel(): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "text-start", id: "1" });
          controller.enqueue({ type: "text-delta", id: "1", delta: "hello" });
          controller.enqueue({ type: "text-end", id: "1" });
          controller.enqueue({
            type: "finish",
            usage: {
              inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 1, text: 1, reasoning: 0 },
            },
            finishReason: { unified: "stop", raw: "stop" },
          });
          controller.close();
        },
      }),
    }),
  });
}

describe("agent loop persistence", () => {
  it("persists durable turn events through jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      const handle = await ctx.agents.create({
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      await ctx.agents.dispose(handle.agent.id);

      const prepared = await ctx.persist.prepare(handle.agent.id);
      const types = prepared.events.map((event) => event.type);
      expect(types).toContain("turn/start");
      expect(types).toContain("assistant/message");
      expect(types).toContain("turn/end");
      await prepared.close();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("resumes a session from disk and continues with a live binding", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      const handle = await ctx.agents.create({
        id: "resume-1",
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      const original = handle.agent.primarySession.snapshot();
      await ctx.agents.dispose(handle.agent.id);

      const resumed = await ctx.agents.resume({
        id: "resume-1",
        model: createMockModel(),
        maxSteps: 3,
      });
      expect(resumed.agent.primarySession.snapshotEvents).toEqual(original.events);
      await ctx.agents.dispose(resumed.agent.id);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the session when persistence creation fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const blocked = join(root, "blocked");
    await writeFile(blocked, "not a directory", "utf8");

    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root: blocked }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      await expect(
        ctx.agents.create({
          id: "rollback-1",
          model: createMockModel(),
          maxSteps: 3,
        }),
      ).rejects.toThrow();
      expect(ctx.sessions.get("rollback-1")).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back the session and scoped setup when create setup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      let scope: symbol | undefined;
      await expect(
        ctx.agents.create({
          id: "create-rollback",
          model: createMockModel(),
          maxSteps: 3,
          setup: async (next) => {
            scope = next.scope;
            next.tools.register("rollback-tool", {} as Tool);
            throw new Error("setup failed");
          },
        }),
      ).rejects.toThrow("setup failed");

      expect(ctx.sessions.get("create-rollback")).toBeUndefined();
      expect(ctx.tools.snapshot(scope)["rollback-tool"]).toBeUndefined();

      const prepared = await ctx.persist.prepare("create-rollback");
      expect(prepared.events).toEqual([]);
      await prepared.close();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rolls back a restored session when resume setup fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      const handle = await ctx.agents.create({
        id: "resume-rollback",
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      await ctx.agents.dispose(handle.agent.id);

      await expect(
        ctx.agents.resume({
          id: "resume-rollback",
          model: createMockModel(),
          maxSteps: 3,
          setup: async () => {
            throw new Error("resume setup failed");
          },
        }),
      ).rejects.toThrow("resume setup failed");

      expect(ctx.sessions.get("resume-rollback")).toBeUndefined();
      const prepared = await ctx.persist.prepare("resume-rollback");
      expect(prepared.events.length).toBeGreaterThan(0);
      await prepared.close();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("persists and restores context snapshots", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      ctx.systemPrompt.registerContextProvider("time", async () => "12:00");
      const handle = await ctx.agents.create({
        id: "context-restore",
        model: createMockModel(),
        maxSteps: 3,
      });
      handle.agent.send("user/message", { content: "hello" });
      await handle.agent.whenIdle();
      await ctx.agents.dispose(handle.agent.id);

      const prepared = await ctx.persist.prepare("context-restore");
      const snapshots = prepared.events.filter((event) => event.type === "context/snapshot");
      expect(snapshots).toHaveLength(1);
      const rendered = snapshots.map((event) => (event.data as { rendered: string }).rendered).join("");
      expect(rendered).toContain("12:00");
      await prepared.close();

      const resumed = await ctx.agents.resume({
        id: "context-restore",
        model: createMockModel(),
        maxSteps: 3,
      });
      const restoredMessages = ctx.modelSurface.deriveMessages(resumed.agent.primarySession);
      expect(restoredMessages.some((message) => message.role === "user" && typeof message.content === "string" && message.content.includes("12:00"))).toBe(
        true,
      );

      resumed.agent.send("user/message", { content: "again" });
      await resumed.agent.whenIdle();
      const restoredAndContinued = resumed.agent.primarySession.snapshotEvents.filter((event) => event.type === "context/snapshot");
      expect(restoredAndContinued.length).toBeGreaterThanOrEqual(2);
      await ctx.agents.dispose(resumed.agent.id);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });

  it("removes the old scope and installs a fresh scope after resume", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fibers = [
      ctx.plugin(sessionStore),
      ctx.plugin(agentRegistry),
      ctx.plugin(modelSurface),
      ctx.plugin(systemPrompt),
      ctx.plugin(toolRuntime),
      ctx.plugin(jsonlPersistence, { root }),
      ctx.plugin(agentLoop),
    ];
    await Promise.all(fibers);

    try {
      let oldContext: AgentContext | undefined;
      const handle = await ctx.agents.create({
        id: "scope-restore",
        model: createMockModel(),
        maxSteps: 3,
        setup: async (next) => {
          oldContext = next;
          next.tools.register("old-tool", {} as Tool);
        },
      });
      expect(ctx.tools.snapshot(oldContext!.scope)["old-tool"]).toBeDefined();
      await ctx.agents.dispose(handle.agent.id);
      expect(ctx.tools.snapshot(oldContext!.scope)["old-tool"]).toBeUndefined();

      let newContext: AgentContext | undefined;
      const resumed = await ctx.agents.resume({
        id: "scope-restore",
        model: createMockModel(),
        maxSteps: 3,
        setup: async (next) => {
          newContext = next;
          next.tools.register("new-tool", {} as Tool);
        },
      });
      expect(ctx.tools.snapshot(oldContext!.scope)["old-tool"]).toBeUndefined();
      expect(ctx.tools.snapshot(newContext!.scope)["new-tool"]).toBeDefined();
      await ctx.agents.dispose(resumed.agent.id);
      expect(ctx.tools.snapshot(newContext!.scope)["new-tool"]).toBeUndefined();
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
      await rm(root, { recursive: true, force: true });
    }
  });
});
