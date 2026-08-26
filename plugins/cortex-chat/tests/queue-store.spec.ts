import { mkdir, rm, readFile } from "node:fs/promises";
import path from "node:path";

import { Context } from "cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentLoop } from "../src/loop.js";
import { TurnQueue } from "../src/queue.js";
import { createWsMessage, toModelMessage, WorkspaceStore } from "../src/workspace-store.js";

const WORKSPACE_DIR = path.join(process.cwd(), "cortex-state");
const WORKSPACE_FILE = path.join(WORKSPACE_DIR, "workspace.jsonl");

beforeEach(async () => {
  await rm(WORKSPACE_FILE, { force: true });
});
afterEach(async () => {
  await rm(WORKSPACE_FILE, { force: true });
});

describe("WorkspaceStore + TurnQueue", () => {
  it("round-trips through JSONL", async () => {
    const ctx = new Context();
    const store = new WorkspaceStore(ctx);
    const a = createWsMessage({ role: "user", content: "hello" } as never);
    const b = createWsMessage({ role: "assistant", content: [{ type: "text", text: "hi" }] } as never);
    await store.append(a, b);
    const all = await store.readAll();
    expect(all).toHaveLength(2);
    expect(all[0].id).toBe(a.id);
    expect(toModelMessage(all[1]).role).toBe("assistant");
  });

  it("count and clear", async () => {
    const ctx = new Context();
    const store = new WorkspaceStore(ctx);
    await store.append(createWsMessage({ role: "user", content: "a" } as never));
    expect(await store.count()).toBe(1);
    await store.clear();
    expect(await store.count()).toBe(0);
    expect(await store.readAll()).toHaveLength(0);
  });

  it("TurnQueue serializes two submit calls", async () => {
    const ctx = new Context();
    const queue = new TurnQueue(ctx);
    const order: string[] = [];
    const p1 = queue.submit({
      messages: [createWsMessage({ role: "user", content: "first" } as never)],
      run: async () => {
        order.push("1-start");
        await new Promise((r) => setTimeout(r, 10));
        order.push("1-end");
      },
    });
    const p2 = queue.submit({
      messages: [createWsMessage({ role: "user", content: "second" } as never)],
      run: async () => {
        order.push("2-start");
        order.push("2-end");
      },
    });
    await Promise.all([p1, p2]);
    expect(order).toEqual(["1-start", "1-end", "2-start", "2-end"]);
  });

  it("submit while running joins instead of scheduling", async () => {
    const ctx = new Context();
    const queue = new TurnQueue(ctx);
    let resolveFirst: () => void;
    const firstStarted = new Promise<void>((r) => {
      resolveFirst = r;
    });
    const first = queue.submit({
      messages: [createWsMessage({ role: "user", content: "first" } as never)],
      run: async () => {
        resolveFirst();
        await new Promise<void>((r) => setTimeout(r, 20));
      },
    });
    await firstStarted;
    // Now queue is active; second submit should join
    await queue.submit({
      messages: [createWsMessage({ role: "user", content: "joined" } as never)],
      run: async () => {
        throw new Error("joined run should not execute");
      },
    });
    expect(queue.drainJoined()).toHaveLength(1);
    await first;
  });

  it("AgentLoop appends trigger to workspace", async () => {
    const ctx = new Context();
    const workspace = new WorkspaceStore(ctx);
    const queue = new TurnQueue(ctx);
    const loop = new AgentLoop({
      ctx,
      workspace,
      messageStore: { getByChannel: async () => [] } as never,
      queue,
      turnQueue: queue,
      system: "test system",
      compaction: null,
      focusSceneId: null,
      maxSteps: 5,
      model: {} as never,
    });
    const trigger = createWsMessage({ role: "user", content: "trigger" } as never);
    await loop.run([trigger]);
    const all = await workspace.readAll();
    expect(all.some((m) => (m as unknown as { id: string }).id === trigger.id)).toBe(true);
  });
});
