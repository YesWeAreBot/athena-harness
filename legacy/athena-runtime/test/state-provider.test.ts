import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { JsonlStateProvider } from "../src/state-provider/jsonl.js";

describe("jsonl state provider", () => {
  it("persists and restores state per Life", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-state-"));
    try {
      const first = new JsonlStateProvider({ id: "story", root, kinds: ["story"] });
      await first.set({ arc: "arc-1", notes: ["hello"] });
      await first.persist("life-1");

      const second = new JsonlStateProvider({ id: "story", root, kinds: ["story"] });
      await second.restore("life-1");
      expect(await second.get()).toEqual({ arc: "arc-1", notes: ["hello"] });

      await second.clear("life-1");
      expect(await second.get()).toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
