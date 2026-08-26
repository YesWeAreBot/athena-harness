import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generateId, type ModelMessage } from "@athena-ai/core";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface Checkpoint {
  id: string;
  ts: number;
  focusSceneId: string | null;
  frameMessages: ModelMessage[];
  compaction: string | null;
}

function checkpointPath(): string {
  return path.join(process.cwd(), "cortex-state", "checkpoint-latest.json");
}

// ─── IO ──────────────────────────────────────────────────────────────────────

export async function loadCheckpoint(): Promise<Checkpoint | null> {
  try {
    const raw = await readFile(checkpointPath(), "utf-8");
    return JSON.parse(raw) as Checkpoint;
  } catch {
    return null;
  }
}

export async function saveCheckpoint(cp: Checkpoint): Promise<void> {
  await mkdir(path.dirname(checkpointPath()), { recursive: true });
  await writeFile(checkpointPath(), JSON.stringify(cp, null, 2), "utf-8");
}

export function createCheckpoint(init: Omit<Checkpoint, "id" | "ts"> & Partial<Pick<Checkpoint, "id" | "ts">>): Checkpoint {
  return {
    id: init.id ?? generateId(),
    ts: init.ts ?? Date.now(),
    focusSceneId: init.focusSceneId,
    frameMessages: init.frameMessages,
    compaction: init.compaction,
  };
}

export function emptyCheckpoint(): Checkpoint {
  return createCheckpoint({ focusSceneId: null, frameMessages: [], compaction: null });
}
