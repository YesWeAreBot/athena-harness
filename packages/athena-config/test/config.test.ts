import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadRuntimeConfig, parseRuntimeConfig } from "../src/index.js";

describe("runtime config", () => {
  it("loads YAML config and substitutes environment variables", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-config-"));
    const path = join(root, "athena.config.yaml");
    process.env.ATHENA_TEST_TOKEN = "secret-token";
    await writeFile(
      path,
      `
runtime:
  name: test-runtime
api:
  token: \${ATHENA_TEST_TOKEN}
modes:
  - id: chat
    package: "@yesimbot/mode-chat"
lives:
  - id: life-1
    mode: chat
`,
      "utf8",
    );

    try {
      const config = await loadRuntimeConfig(path);
      expect(config.runtime.name).toBe("test-runtime");
      expect(config.api.token).toBe("secret-token");
      expect(config.modes[0]?.package).toBe("@yesimbot/mode-chat");
      expect(config.lives[0]?.mode).toBe("chat");
    } finally {
      delete process.env.ATHENA_TEST_TOKEN;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("applies defaults for missing runtime fields", () => {
    const config = parseRuntimeConfig({});
    expect(config.runtime.name).toBe("athena");
    expect(config.core.persistence).toBe("jsonl");
    expect(config.api.port).toBe(7788);
  });
});
