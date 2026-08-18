import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ModeStateKind, ModeStateProvider } from "../mode/types.js";

export interface JsonlStateProviderConfig {
  readonly id: string;
  readonly root: string;
  readonly kinds: readonly ModeStateKind[];
}

export class JsonlStateProvider implements ModeStateProvider {
  private current: unknown;

  constructor(private readonly config: JsonlStateProviderConfig) {}

  get id(): string {
    return this.config.id;
  }

  get kinds(): readonly ModeStateKind[] {
    return this.config.kinds;
  }

  async get(): Promise<unknown> {
    return this.current;
  }

  async set(next: unknown): Promise<void> {
    this.current = next;
  }

  async restore(lifeId: string): Promise<void> {
    const content = await readFile(this.path(lifeId), "utf8").catch((cause: NodeJS.ErrnoException) => {
      if (cause.code === "ENOENT") return undefined;
      throw cause;
    });
    this.current = content === undefined ? undefined : JSON.parse(content);
  }

  async persist(lifeId: string): Promise<void> {
    await mkdir(this.config.root, { recursive: true });
    await writeFile(this.path(lifeId), JSON.stringify(this.current ?? null), "utf8");
  }

  async dispose(): Promise<void> {
    this.current = undefined;
  }

  async clear(lifeId: string): Promise<void> {
    await rm(this.path(lifeId), { force: true });
    this.current = undefined;
  }

  private path(lifeId: string): string {
    return join(this.config.root, `${encodeURIComponent(lifeId)}.json`);
  }
}
