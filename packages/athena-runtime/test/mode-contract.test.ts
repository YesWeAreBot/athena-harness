import { SessionRegistry } from "@athena/session";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { lifeRegistry } from "../src/life/index.js";
import { memoryRegistry } from "../src/memory/index.js";
import { modeRegistry } from "../src/mode/index.js";
import { schedulerRegistry } from "../src/scheduler/index.js";

describe("Mode contract: future projects as composition", () => {
  it("Chat Mode composes percept handling and a memory provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(modeRegistry),
      ctx.plugin(memoryRegistry),
      ctx.plugin(lifeRegistry),
    ]);
    try {
      let remembers = 0;
      const provider = {
        id: "chat-memory",
        scopes: ["conversation"] as const,
        remember: async (input: { lifeId: string; scope: string; category: string; content: string }) => {
          remembers++;
          return {
            id: "chat-1",
            lifeId: input.lifeId,
            scope: input.scope,
            category: input.category,
            content: input.content,
            importance: 0.5,
            confidence: 0.5,
            createdAt: Date.now(),
          };
        },
        recall: async () => [],
        forget: async () => true,
        clear: async () => {},
      };
      ctx.modes.register({
        name: "chat",
        setup: async () => ({
          providers: { memory: provider },
          handle: async (event) => event.kind === "message-created",
        }),
      });

      const handle = ctx.lives.create({ id: "contract-chat" });
      await handle.createMode("chat", {});
      await expect(
        handle.dispatchPercept({
          id: "p1",
          time: Date.now(),
          bodyId: "im",
          kind: "message-created",
          data: { text: "hi" },
        }),
      ).resolves.toBe(true);

      await ctx.memory.remember({
        lifeId: "contract-chat",
        scope: "conversation",
        category: "recent",
        content: "hi",
      });
      expect(remembers).toBe(1);

      await ctx.lives.dispose("contract-chat");
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("World Mode composes scheduler tasks through ModeContext", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(modeRegistry),
      ctx.plugin(schedulerRegistry),
      ctx.plugin(lifeRegistry),
    ]);
    try {
      let runs = 0;
      ctx.modes.register({
        name: "world",
        setup: async (modeCtx) => {
          modeCtx.scheduler?.schedule({
            kind: "tingle",
            after: 10,
            run: async () => {
              runs++;
            },
          });
          return {};
        },
      });

      const handle = ctx.lives.create({ id: "contract-world" });
      const mode = await handle.createMode("world", {});
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(runs).toBe(1);

      await ctx.modes.dispose(mode.id);
      await ctx.lives.dispose("contract-world");
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("World Mode can provide and clean up its own scheduler provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(modeRegistry),
      ctx.plugin(lifeRegistry),
    ]);
    try {
      let schedules = 0;
      let cancelled = 0;
      const provider = {
        id: "world-scheduler",
        kinds: ["tingle"] as const,
        schedule: () => {
          schedules++;
          return {
            id: "task-1",
            kind: "tingle",
            nextRunAt: Date.now() + 10,
            cancel: () => {
              cancelled++;
              return true;
            },
          };
        },
        cancel: () => false,
        cancelAll: () => {
          cancelled++;
        },
      };
      let captured: { scheduler?: { schedule(options: { kind: string }): unknown } } | undefined;
      ctx.modes.register({
        name: "world-provider",
        setup: async (modeCtx) => {
          captured = modeCtx as never;
          return {
            providers: { scheduler: provider },
            start: async () => {
              modeCtx.scheduler?.schedule({
                kind: "tingle",
                after: 10,
                run: async () => {},
              });
            },
          };
        },
      });

      const handle = ctx.lives.create({ id: "contract-world-provider" });
      const mode = await handle.createMode("world-provider", {});
      expect(schedules).toBe(1);
      expect(captured?.scheduler).toBeDefined();

      await ctx.modes.dispose(mode.id);
      expect(cancelled).toBeGreaterThan(0);
      await ctx.lives.dispose("contract-world-provider");
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("Interlude Mode composes hooks and a story memory provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(modeRegistry),
      ctx.plugin(memoryRegistry),
      ctx.plugin(lifeRegistry),
    ]);
    try {
      let hookCalls = 0;
      let remembers = 0;
      const provider = {
        id: "interlude-story",
        scopes: ["story"] as const,
        remember: async (input: { lifeId: string; scope: string; category: string; content: string }) => {
          remembers++;
          return {
            id: "story-1",
            lifeId: input.lifeId,
            scope: input.scope,
            category: input.category,
            content: input.content,
            importance: 0.5,
            confidence: 0.5,
            createdAt: Date.now(),
          };
        },
        recall: async () => [],
        forget: async () => true,
        clear: async () => {},
      };
      ctx.modes.register({
        name: "interlude",
        setup: async () => ({
          providers: { memory: provider },
          hooks: {
            onPercept: async (event) => {
              hookCalls++;
              return event.kind === "message-created";
            },
          },
        }),
      });

      const handle = ctx.lives.create({ id: "contract-interlude" });
      await handle.createMode("interlude", {});
      await expect(
        handle.dispatchPercept({
          id: "p1",
          time: Date.now(),
          bodyId: "im",
          kind: "message-created",
          data: {},
        }),
      ).resolves.toBe(true);
      expect(hookCalls).toBe(1);

      await ctx.memory.remember({
        lifeId: "contract-interlude",
        scope: "story",
        category: "arc",
        content: "story content",
      });
      expect(remembers).toBe(1);

      await ctx.lives.dispose("contract-interlude");
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
