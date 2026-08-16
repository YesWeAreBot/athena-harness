import { createId } from "../internal.js";
import type { MemoryInput, MemoryRecord } from "./types.js";

export function createMemoryRecord(input: MemoryInput): MemoryRecord {
  return {
    id: createId("memory"),
    lifeId: input.lifeId,
    scope: input.scope,
    category: input.category,
    content: input.content,
    importance: input.importance ?? 0.5,
    confidence: input.confidence ?? 0.5,
    ...(input.sourcePerceptId === undefined ? {} : { sourcePerceptId: input.sourcePerceptId }),
    createdAt: Date.now(),
  };
}
