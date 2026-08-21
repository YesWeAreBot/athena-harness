import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const created: string[] = [];

/** Write a `models.yml` into a fresh temp directory and return its full path. */
export function writeModelsConfig(yaml: string): string {
  const dir = mkdtempSync(join(tmpdir(), "athena-ai-"));
  created.push(dir);
  const path = join(dir, "models.yml");
  writeFileSync(path, yaml, "utf8");
  return path;
}

/** A path inside a fresh temp directory where nothing has been written. */
export function missingConfigPath(): string {
  const dir = mkdtempSync(join(tmpdir(), "athena-ai-"));
  created.push(dir);
  return join(dir, "models.yml");
}

export function cleanupModelsConfigs(): void {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
}
