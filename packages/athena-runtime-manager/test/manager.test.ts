import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parseRuntimeConfig } from "@yesimbot/athena-config";
import { describe, expect, it } from "vitest";

import { RuntimeManager } from "../src/index.js";

describe("runtime manager", () => {
  it("boots services and reconciles configured lives", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-manager-"));
    const manager = new RuntimeManager(
      parseRuntimeConfig({
        runtime: { name: "test", dataDir: root },
        core: { persistence: "none" },
        modes: [{ id: "echo", package: "builtin:echo" }],
        bodies: [{ id: "manual", package: "builtin:manual", config: { name: "Manual" } }],
        lives: [{ id: "life-1", mode: "echo", bodies: ["manual"] }],
      }),
    );

    try {
      await manager.start();
      expect(manager.status().lives).toHaveLength(1);
      expect(manager.status().lives[0]).toMatchObject({ id: "life-1", bodyIds: ["manual"] });
      expect(manager.status().bodies[0]).toMatchObject({ id: "manual", name: "Manual" });
      expect(manager.status().pipelines.map((item) => item.id)).toEqual(["echo"]);
      expect(manager.context.lives.get("life-1")).toBeDefined();
    } finally {
      await manager.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });
});
