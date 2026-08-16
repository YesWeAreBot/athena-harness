import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { MediaStore } from "../src/media-store/index.js";

describe("media store", () => {
  it("saves, lists, reads, and deletes media files", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-media-"));
    const ctx = new Context();
    const fiber = ctx.plugin(MediaStore, { root });
    await fiber;
    try {
      const file = await ctx.mediaStore.save({
        type: "image",
        mime: "image/png",
        data: Buffer.from("png-data"),
      });
      expect(file.id).toBeDefined();
      expect(file.type).toBe("image");
      expect(file.size).toBe(8);

      const listed = await ctx.mediaStore.list();
      expect(listed).toHaveLength(1);
      expect(listed[0]!.id).toBe(file.id);

      const entry = await ctx.mediaStore.get(file.id);
      expect(entry.file.id).toBe(file.id);
      expect(entry.data.toString("utf8")).toBe("png-data");

      expect(await ctx.mediaStore.delete(file.id)).toBe(true);
      expect(await ctx.mediaStore.list()).toHaveLength(0);
    } finally {
      await fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
