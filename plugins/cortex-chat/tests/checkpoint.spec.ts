import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import Life from "../../life/src/index.js";
import { CheckpointStore, createCheckpoint, emptyCheckpoint } from "../src/checkpoint.js";
import type { Checkpoint } from "../src/checkpoint.js";

let tmpRoots: string[] = [];

afterEach(async () => {
  for (const root of tmpRoots) await rm(root, { recursive: true, force: true });
  tmpRoots = [];
});

async function createCheckpointStore(lifeId = "test-life"): Promise<{ store: CheckpointStore; ctx: Context; dataDir: string; filePath: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "athena-checkpoint-"));
  tmpRoots.push(root);
  const ctx = new Context();
  await ctx.plugin(Life, { id: lifeId, dataDir: root });
  const store = new CheckpointStore(ctx);
  const dataDir = (ctx as unknown as { life: { dataDir: string } }).life.dataDir;
  const filePath = path.join(dataDir, "cortex-chat", "checkpoint.json");
  return { store, ctx, dataDir, filePath };
}

function checkpoint(label: string): Checkpoint {
  return createCheckpoint({
    focus: { bodySid: `sandbox:${label}`, channelId: "general" },
    history: [{ role: "user", content: `${label} history` }],
    lastFocusHistory: [{ role: "assistant", content: `${label} last focus` }],
    compaction: `memory-${label}`,
  });
}

describe("Checkpoint persistence", () => {
  it("round-trips focus, frame regions, and compaction", async () => {
    const { store, filePath } = await createCheckpointStore();
    const cp = checkpoint("alice");
    await store.save(cp);
    await expect(store.load()).resolves.toEqual(cp);
    expect(JSON.parse(await readFile(filePath, "utf-8"))).not.toHaveProperty("stableFingerprint");
  });

  it("distinguishes missing files from malformed files", async () => {
    const { store, filePath } = await createCheckpointStore();
    await expect(store.load()).resolves.toBeNull();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ malformed json", "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
  });

  it("writes per-Life checkpoint paths", async () => {
    const { store: alice } = await createCheckpointStore("alice");
    const { store: bob } = await createCheckpointStore("bob");
    await alice.save(checkpoint("alice"));
    await expect(bob.load()).resolves.toBeNull();
  });

  it("emptyCheckpoint uses required defaults", () => {
    const cp = emptyCheckpoint();
    expect(cp.version).toBe(2);
    expect(cp.focus).toBeNull();
    expect(cp.history).toEqual([]);
    expect(cp.lastFocusHistory).toEqual([]);
    expect(cp.compaction).toBeNull();
    expect(typeof cp.id).toBe("string");
    expect(typeof cp.createdAt).toBe("number");
  });

  it("createCheckpoint uses version two and generates an id", () => {
    const cp = createCheckpoint({ focus: null, history: [], lastFocusHistory: [], compaction: null });
    expect(cp.version).toBe(2);
    expect(cp.id.length).toBeGreaterThan(0);
    expect(typeof cp.createdAt).toBe("number");
  });

  it("rejects a checkpoint with the old version", async () => {
    const { store, filePath } = await createCheckpointStore();
    const cp = checkpoint("old");
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...cp, version: 1 }), "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
  });

  it("validates focus shape when non-null", async () => {
    const { store, filePath } = await createCheckpointStore();
    const cp = createCheckpoint({ focus: { bodySid: "sandbox:alice", channelId: "general" }, history: [], lastFocusHistory: [], compaction: null });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...cp, focus: { bodySid: "onlyOne" } }), "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
  });

  it("validates both frame regions as ModelMessage arrays", async () => {
    const { store, filePath } = await createCheckpointStore();
    const cp = createCheckpoint({ focus: null, history: [], lastFocusHistory: [], compaction: null });
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify({ ...cp, history: "not-an-array" }), "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
    await writeFile(filePath, JSON.stringify({ ...cp, lastFocusHistory: "not-an-array" }), "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
  });

  it("propagates errors with path context", async () => {
    const { store, filePath } = await createCheckpointStore();
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "{ bad", "utf-8");
    await expect(store.load()).rejects.toThrow(new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("saves atomically and preserves the previous checkpoint on malformed overwrite", async () => {
    const { store, filePath } = await createCheckpointStore();
    const first = checkpoint("first");
    await store.save(first);
    await writeFile(filePath, "{ malformed", "utf-8");
    await expect(store.load()).rejects.toThrow(/checkpoint/);
    const second = createCheckpoint({ focus: null, history: [], lastFocusHistory: [], compaction: "second" });
    await store.save(second);
    await expect(store.load()).resolves.toEqual(second);
  });

  it("leaves no temporary file after a successful atomic save", async () => {
    const { store, filePath } = await createCheckpointStore();
    await store.save(checkpoint("keep"));
    const entries = await readdir(path.dirname(filePath));
    expect(entries.some((entry) => entry.startsWith("checkpoint.json.tmp"))).toBe(false);
    expect(JSON.parse(await readFile(filePath, "utf-8")).history).toEqual([{ role: "user", content: "keep history" }]);
  });
});
