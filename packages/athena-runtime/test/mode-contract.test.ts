import { SessionRegistry } from "@athena/session";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { LifeRegistry } from "../src/life/index.js";
import { InMemoryMemory } from "../src/memory/index.js";
import { ModeRegistry } from "../src/mode/index.js";
import { SchedulerRegistry } from "../src/scheduler/index.js";

describe("Mode contract: future projects as composition", () => {
  it("Chat Mode composes percept handling and a memory provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(ModeRegistry), ctx.plugin(InMemoryMemory), ctx.plugin(LifeRegistry)]);
    try {
      let remembers = 0;
      let derives = 0;
      let compacts = 0;
      let restores = 0;
      let disposed = 0;
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
        derive: async () => {
          derives++;
          return [];
        },
        compact: async () => {
          compacts++;
          return [];
        },
        restore: async () => {
          restores++;
        },
        forget: async () => true,
        clear: async () => {},
        dispose: async () => {
          disposed++;
        },
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
      expect(restores).toBe(1);
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
      await ctx.memory.derive("contract-chat");
      await ctx.memory.compact("contract-chat");
      expect(derives).toBe(1);
      expect(compacts).toBe(1);

      await ctx.lives.dispose("contract-chat");
      expect(disposed).toBe(1);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("World Mode composes scheduler tasks through ModeContext", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([
      ctx.plugin(SessionRegistry),
      ctx.plugin(ModeRegistry),
      ctx.plugin(SchedulerRegistry),
      ctx.plugin(InMemoryMemory),
      ctx.plugin(LifeRegistry),
    ]);
    try {
      let runs = 0;
      let derives = 0;
      let compacts = 0;
      let restores = 0;
      let disposed = 0;
      const provider = {
        id: "world-memory",
        scopes: ["world", "facts"] as const,
        remember: async () => {
          return {
            id: "world-1",
            lifeId: "contract-world",
            scope: "facts",
            category: "fact",
            content: "world fact",
            importance: 0.5,
            confidence: 0.5,
            createdAt: Date.now(),
          };
        },
        recall: async () => [],
        derive: async () => {
          derives++;
          return [];
        },
        compact: async () => {
          compacts++;
          return [];
        },
        restore: async () => {
          restores++;
        },
        forget: async () => true,
        clear: async () => {},
        dispose: async () => {
          disposed++;
        },
      };
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
          return { providers: { memory: provider } };
        },
      });

      const handle = ctx.lives.create({ id: "contract-world" });
      const mode = await handle.createMode("world", {});
      expect(restores).toBe(1);
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(runs).toBe(1);
      await ctx.memory.derive("contract-world");
      await ctx.memory.compact("contract-world");
      expect(derives).toBe(1);
      expect(compacts).toBe(1);

      await ctx.modes.dispose(mode.id);
      await ctx.lives.dispose("contract-world");
      expect(disposed).toBe(1);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });

  it("World Mode can provide and clean up its own scheduler provider", async () => {
    const ctx = new Context();
    const fibers = await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(ModeRegistry), ctx.plugin(LifeRegistry)]);
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
            kind: "tingle" as const,
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
    const fibers = await Promise.all([ctx.plugin(SessionRegistry), ctx.plugin(ModeRegistry), ctx.plugin(InMemoryMemory), ctx.plugin(LifeRegistry)]);
    try {
      let hookCalls = 0;
      let remembers = 0;
      let derives = 0;
      let compacts = 0;
      let restores = 0;
      let disposed = 0;
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
        derive: async () => {
          derives++;
          return [];
        },
        compact: async () => {
          compacts++;
          return [];
        },
        restore: async () => {
          restores++;
        },
        forget: async () => true,
        clear: async () => {},
        dispose: async () => {
          disposed++;
        },
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
      expect(restores).toBe(1);
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
      await ctx.memory.derive("contract-interlude");
      await ctx.memory.compact("contract-interlude");
      expect(derives).toBe(1);
      expect(compacts).toBe(1);

      await ctx.lives.dispose("contract-interlude");
      expect(disposed).toBe(1);
    } finally {
      await Promise.all(fibers.map((fiber) => fiber.dispose()));
    }
  });
});
