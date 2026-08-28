import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateId } from "@athena-ai/core";
import type { ModelMessage } from "@athena-ai/core";
import type { Context } from "cordis";

import type { SceneAddress } from "./scene.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Frame {
  readonly focus: SceneAddress | null;
  readonly history: readonly ModelMessage[];
  readonly lastFocusHistory: readonly ModelMessage[];
}

export interface Checkpoint extends Frame {
  readonly version: 2;
  readonly id: string;
  readonly createdAt: number;
  readonly compaction: string | null;
}

function isValidSceneAddress(value: unknown): value is SceneAddress {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const bodySid = rec["bodySid"];
  const channelId = rec["channelId"];
  return typeof bodySid === "string" && bodySid.length > 0 && typeof channelId === "string" && channelId.length > 0;
}

function isValidModelMessage(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const rec = value as Record<string, unknown>;
  const role = rec["role"];
  if (typeof role !== "string") return false;
  if (role !== "system" && role !== "user" && role !== "assistant" && role !== "tool") return false;
  if (!("content" in rec)) return false;
  return true;
}
// ─── Constructors ────────────────────────────────────────────────────────────

export function createCheckpoint(input: Omit<Checkpoint, "id" | "createdAt" | "version">): Checkpoint {
  return {
    version: 2,
    id: generateId(),
    createdAt: Date.now(),
    focus: input.focus,
    history: input.history,
    lastFocusHistory: input.lastFocusHistory,
    compaction: input.compaction,
  };
}

export function emptyCheckpoint(): Checkpoint {
  return createCheckpoint({
    focus: null,
    history: [],
    lastFocusHistory: [],
    compaction: null,
  });
}

// ─── Store ───────────────────────────────────────────────────────────────────

export class CheckpointStore {
  private readonly filePath: string;

  constructor(private ctx: Context) {
    // SAFETY: ctx.life is provided by Life plugin; test helpers use real Life
    const life = (ctx as unknown as { life?: { dataDir?: string } }).life;
    if (!life?.dataDir) {
      throw new Error("CheckpointStore requires ctx.life.dataDir — Life service not available");
    }
    this.filePath = path.join(life.dataDir, "cortex-chat", "checkpoint.json");
  }

  async load(): Promise<Checkpoint | null> {
    let raw: string;
    try {
      raw = await readFile(this.filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to load checkpoint at ${this.filePath}: ${message}`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid checkpoint at ${this.filePath}: ${message}`);
    }

    return this.validate(parsed);
  }

  async save(checkpoint: Checkpoint): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp`;
    const data = JSON.stringify(checkpoint, null, 2);
    try {
      await writeFile(tmpPath, data, "utf-8");
    } catch (error) {
      try {
        await rm(tmpPath, { force: true });
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to write checkpoint at ${this.filePath}: ${message}`);
    }
    try {
      await rename(tmpPath, this.filePath);
    } catch (error) {
      try {
        await rm(tmpPath, { force: true });
      } catch {}
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to persist checkpoint at ${this.filePath}: ${message}`);
    }
  }

  private validate(value: unknown): Checkpoint {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: expected object`);
    }
    const rec = value as Record<string, unknown>;

    const version = rec["version"];
    if (version !== 2) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: version must be 2`);
    }

    const id = rec["id"];
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: id must be a non-empty string`);
    }

    const createdAt = rec["createdAt"];
    if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: createdAt must be a number`);
    }

    const focus = rec["focus"];
    if (focus !== null && !isValidSceneAddress(focus)) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: focus must be null or SceneAddress with bodySid and channelId`);
    }

    const history = rec["history"];
    if (!Array.isArray(history)) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: history must be an array`);
    }
    for (let i = 0; i < history.length; i++) {
      const msg = history[i];
      if (!isValidModelMessage(msg)) {
        throw new Error(`Invalid checkpoint at ${this.filePath}: history[${i}] must be a ModelMessage with role and content`);
      }
    }

    const lastFocusHistory = rec["lastFocusHistory"];
    if (!Array.isArray(lastFocusHistory)) {
      throw new Error(`Invalid checkpoint at ${this.filePath}: lastFocusHistory must be an array`);
    }
    for (let i = 0; i < lastFocusHistory.length; i++) {
      const msg = lastFocusHistory[i];
      if (!isValidModelMessage(msg)) {
        throw new Error(`Invalid checkpoint at ${this.filePath}: lastFocusHistory[${i}] must be a ModelMessage with role and content`);
      }
    }

    const compaction = rec["compaction"];
    if (compaction !== null && typeof compaction !== "string") {
      throw new Error(`Invalid checkpoint at ${this.filePath}: compaction must be string or null`);
    }

    // SAFETY: every element passed the ModelMessage shape checks above.
    return {
      version,
      id,
      createdAt,
      focus,
      history: history as ModelMessage[],
      lastFocusHistory: lastFocusHistory as ModelMessage[],
      compaction,
    };
  }
}
