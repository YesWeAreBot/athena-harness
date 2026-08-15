import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ToolCallPart } from "ai";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { jsonlPersistence } from "../src/persist/jsonl.js";
import { Session } from "../src/session/index.js";

describe("jsonl persistence", () => {
  it("persists, flushes, closes, and restores a session", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlPersistence, { root });
    await fiber;

    try {
      const session = new Session({ id: "life-1" });
      session.append("user/message", { content: "hello" }, { surfaceOp: "append" });

      const binding = await ctx.persist.create(session.header);
      binding.append(session.snapshotEvents);
      await binding.flush();
      await binding.close();

      const prepared = await ctx.persist.prepare("life-1");
      expect(prepared.header).toEqual(session.header);
      expect(prepared.events).toEqual(session.snapshotEvents);
      await prepared.close();
    } finally {
      await fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects duplicate session creation", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlPersistence, { root });
    await fiber;

    try {
      const header = { id: "duplicate", createdAt: 1 };
      const binding = await ctx.persist.create(header);
      await expect(ctx.persist.create(header)).rejects.toThrow();
      await binding.close();
    } finally {
      await fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects malformed persisted files", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlPersistence, { root });
    await fiber;

    try {
      const path = join(root, `${encodeURIComponent("broken")}.jsonl`);
      await writeFile(path, "not-json\n", "utf8");
      await expect(ctx.persist.prepare("broken")).rejects.toThrow(/malformed JSON/);
    } finally {
      await fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("repairs a crash-orphaned open turn", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-"));
    const ctx = new Context();
    const fiber = ctx.plugin(jsonlPersistence, { root });
    await fiber;

    try {
      const session = new Session({ id: "crash-1" });
      session.append("turn/start", { turn: 1 });
      session.append("step/start", { turn: 1, step: 1 });
      session.append("tool/call", {
        turn: 1,
        step: 1,
        call: {
          type: "tool-call",
          toolCallId: "call-1",
          toolName: "echo",
          args: {},
        } as unknown as ToolCallPart,
      });

      const binding = await ctx.persist.create(session.header);
      binding.append(session.snapshotEvents);
      await binding.close();

      const prepared = await ctx.persist.prepare("crash-1");
      const events = prepared.events;
      expect(events.length).toBe(session.snapshotEvents.length + 3);
      expect(events.some((event) => event.type === "tool/result")).toBe(true);
      expect(events.some((event) => event.type === "tool/result" && (event.data as { status?: string }).status === "interrupted")).toBe(true);
      expect(events.at(-1)?.data).toMatchObject({
        reason: { kind: "interrupted" },
      });
      await prepared.close();
    } finally {
      await fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
