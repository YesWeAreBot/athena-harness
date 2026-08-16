import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { loadBodyPackage, loadModePackage } from "../src/index.js";

const modeFixture = fileURLToPath(new URL("./fixtures/mode-chat/", import.meta.url));
const bodyFixture = fileURLToPath(new URL("./fixtures/body-onebot/", import.meta.url));

describe("athena package loader", () => {
  it("loads a Mode package with manifest and config validation", async () => {
    const loaded = await loadModePackage(modeFixture, { model: "gpt" });
    expect(loaded.manifest.name).toBe("@fixture/mode-chat");
    expect(loaded.mode.name).toBe("chat");
    expect(loaded.config).toEqual({ model: "gpt" });
  });

  it("rejects invalid Mode config", async () => {
    await expect(loadModePackage(modeFixture, {})).rejects.toThrow(/model is required/);
  });

  it("loads a Body package with a configurable adapter factory", async () => {
    const loaded = await loadBodyPackage(bodyFixture, { id: "onebot", name: "OneBot" });
    const adapter = loaded.createAdapter(loaded.config);
    expect(adapter.id).toBe("onebot");
    expect(adapter.name).toBe("OneBot");
  });

  it("rejects Body config missing required id", async () => {
    await expect(loadBodyPackage(bodyFixture, {})).rejects.toThrow(/id is required/);
  });
});
