import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createId } from "../internal.js";

export type MediaStoreType = "image" | "audio" | "video" | "file";

export interface MediaStoreConfig {
  readonly root: string;
}

export interface MediaFileInput {
  readonly id?: string;
  readonly type: MediaStoreType;
  readonly mime?: string;
  readonly data: Buffer | string;
}

export interface MediaFileMetadata {
  readonly id: string;
  readonly type: MediaStoreType;
  readonly mime?: string;
  readonly size: number;
  readonly createdAt: number;
}

export interface MediaFileEntry {
  readonly file: MediaFileMetadata;
  readonly data: Buffer;
}

declare module "cordis" {
  interface Context {
    mediaStore: MediaStore;
  }
}

export class MediaStore extends Service {
  static provide = "mediaStore";

  constructor(
    ctx: Context,
    private readonly config: MediaStoreConfig,
  ) {
    super(ctx, "mediaStore");
  }

  async save(input: MediaFileInput): Promise<MediaFileMetadata> {
    await mkdir(this.config.root, { recursive: true });
    const id = input.id ?? createId("media");
    const data = typeof input.data === "string" ? Buffer.from(input.data, "utf8") : input.data;
    const file: MediaFileMetadata = {
      id,
      type: input.type,
      ...(input.mime === undefined ? {} : { mime: input.mime }),
      size: data.length,
      createdAt: Date.now(),
    };
    await writeFile(this.dataPath(id), data);
    await writeFile(this.metaPath(id), JSON.stringify(file), "utf8");
    return file;
  }

  async get(id: string): Promise<MediaFileEntry> {
    const file = JSON.parse(await readFile(this.metaPath(id), "utf8")) as MediaFileMetadata;
    const data = await readFile(this.dataPath(id));
    return { file, data };
  }

  async list(): Promise<readonly MediaFileMetadata[]> {
    try {
      const entries = await readdir(this.config.root, { withFileTypes: true });
      const files: MediaFileMetadata[] = [];
      for (const entry of entries.filter((item) => item.isFile() && item.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
        const id = decodeURIComponent(entry.name.slice(0, -5));
        try {
          files.push(JSON.parse(await readFile(this.metaPath(id), "utf8")) as MediaFileMetadata);
        } catch {
          // skip malformed metadata without failing the whole listing
        }
      }
      return files;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw cause;
    }
  }

  async delete(id: string): Promise<boolean> {
    try {
      await rm(this.dataPath(id), { force: true });
      await rm(this.metaPath(id), { force: true });
      return true;
    } catch {
      return false;
    }
  }

  private dataPath(id: string): string {
    return join(this.config.root, `${encodeURIComponent(id)}.bin`);
  }

  private metaPath(id: string): string {
    return join(this.config.root, `${encodeURIComponent(id)}.json`);
  }
}
