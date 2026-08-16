import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createRuntimeApiServer, type RuntimeApiManager } from "../src/index.js";

describe("runtime api", () => {
  it("serves management endpoints and the console", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-console-"));
    await writeFile(join(root, "index.html"), "<h1>console</h1>", "utf8");
    const manager: RuntimeApiManager = {
      status: () => ({ name: "test" }),
      listLives: () => [{ id: "life-1" }],
      createLife: async (input) => ({ id: input.id }),
      removeLife: async () => true,
      listBodies: () => [{ id: "manual" }],
      listModes: () => [{ name: "echo" }],
      listPipelines: () => [{ id: "echo" }],
    };
    const server = createRuntimeApiServer({ manager, consoleDir: root });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    try {
      const status = await fetch(`http://127.0.0.1:${port}/api/status`);
      expect(await status.json()).toEqual({ name: "test" });
      const lives = await fetch(`http://127.0.0.1:${port}/api/lives`);
      expect(await lives.json()).toEqual([{ id: "life-1" }]);
      const created = await fetch(`http://127.0.0.1:${port}/api/lives`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "life-2" }),
      });
      expect(await created.json()).toEqual({ id: "life-2" });
      const page = await fetch(`http://127.0.0.1:${port}/`);
      expect(await page.text()).toBe("<h1>console</h1>");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      await rm(root, { recursive: true, force: true });
    }
  });
});
