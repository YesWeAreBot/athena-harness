import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LanguageModelV4 } from "@ai-sdk/provider";
import { AIService, ToolRegistry } from "@athena-ai/core";
import type { Body } from "@athena-ai/protocol";
import { Channel, IMBody } from "@athena-ai/protocol-im";
import type { Message } from "@athena-ai/protocol-im";
import { parse } from "@cordisjs/element";
import type { Fragment } from "@cordisjs/element";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { MockProviderV4 } from "ai/test";
import { Context } from "cordis";

import Life from "../../life/src/index.js";
import CortexChat from "../src/index.js";

/**
 * Shared harness for the integration specs.
 *
 * Everything inside the process is real — Cordis, database, Life, Nerve,
 * ToolRegistry, AIService, CortexChat. Only the two things outside it are faked:
 * the platform transport (`FakeIMBody`) and the language model (`scriptedModel`).
 */

// ─── Body ───────────────────────────────────────────────────────────────────

export interface ReceiveOptions {
  readonly channelId: string;
  readonly content: string;
  readonly messageId: string;
  readonly userId?: string;
  /** Direct messages trigger a turn on their own; channel messages need a mention. */
  readonly direct?: boolean;
}

/**
 * A real `IMBody` whose platform is an array in memory.
 *
 * It behaves like an adapter on both edges: inbound events carry parsed
 * `elements` so mention routing can work, and every outbound message dispatches
 * the `send` event that outbound archiving listens for.
 */
export class FakeIMBody extends IMBody<unknown> {
  public override platform: string;
  public readonly sent: Array<{ channelId: string; content: string }> = [];
  /** When set, the next `createMessage` rejects with it, like a platform refusal. */
  public rejectNextSend: Error | null = null;

  constructor(ctx: Context, platform: string, selfId: string) {
    super(ctx, undefined);
    this.platform = platform;
    this.selfId = selfId;
    this.status = "online";
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async createMessage(channelId: string, content: Fragment): Promise<Message[]> {
    const rejection = this.rejectNextSend;
    if (rejection) {
      this.rejectNextSend = null;
      throw rejection;
    }

    const text = String(content);
    this.sent.push({ channelId, content: text });
    const id = `out-${this.selfId}-${this.sent.length}`;
    this.dispatch(
      this.session({
        id: `event-${id}`,
        type: "send",
        channel: this.channelOf(channelId),
        user: { id: this.selfId, name: "Athena" },
        message: { id, content: text, elements: parse(text) },
      }),
    );
    return [{ id, content: text }];
  }

  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: Channel.Type.DIRECT };
  }

  /** Dispatch an inbound message exactly like an adapter would. */
  receive(options: ReceiveOptions): void {
    const userId = options.userId ?? "u1";
    const direct = options.direct ?? options.channelId.startsWith("@");
    const channel: Channel = { id: options.channelId, type: direct ? Channel.Type.DIRECT : Channel.Type.TEXT };
    this.dispatch(
      this.session({
        id: `event-${options.messageId}`,
        type: "message-created",
        channel,
        user: { id: userId, name: userId },
        message: { id: options.messageId, content: options.content, elements: parse(options.content), channel },
      }),
    );
  }

  private channelOf(channelId: string): Channel {
    return { id: channelId, type: channelId.startsWith("@") ? Channel.Type.DIRECT : Channel.Type.TEXT };
  }
}

// ─── Harness ────────────────────────────────────────────────────────────────

/** AIService refuses a configured path that does not exist, so write an empty registry. */
export function emptyModelsConfig(): string {
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), "athena-chat-models-")), "models.yml");
  writeFileSync(filePath, "", "utf8");
  return filePath;
}

export interface InstalledCortex {
  readonly cortex: CortexChat;
  dispose(): Promise<void>;
}

export interface LifeHarness {
  /** Life-scoped Context: `life`, `cortex` and `nerve` are isolated here. */
  readonly ctx: Context;
  /** Where this Life's checkpoint and workspace live. */
  readonly dataDir: string;
  /** Register another Body in this Life's Nerve domain. */
  body(platform: string, selfId: string): FakeIMBody;
  /** Install a CortexChat and wait until restoration finished and routing is live. */
  install(config?: Partial<CortexChat.Config>): Promise<InstalledCortex>;
}

export interface Harness {
  readonly root: Context;
  /** Parent of every Life data directory, so isolation is the Life's own doing. */
  readonly dataRoot: string;
  life(id: string): Promise<LifeHarness>;
}

/**
 * Root context with the global services, plus a `scripted` provider exposing
 * `models` under `scripted:<key>`.
 */
export async function createHarness(models: Record<string, LanguageModelV4>): Promise<Harness> {
  const root = new Context();
  await root.plugin(Database);
  await root.plugin(MemoryDriver);
  await root.plugin(AIService, { configPath: emptyModelsConfig() });
  await root.plugin(ToolRegistry);
  root.ai.register("scripted", new MockProviderV4({ languageModels: models }));

  const dataRoot = mkdtempSync(path.join(tmpdir(), "athena-chat-lives-"));

  return {
    root,
    dataRoot,
    life: async (id: string): Promise<LifeHarness> => {
      const ctx = root.isolate("life", Symbol(id)).isolate("cortex", Symbol(id)).isolate("nerve", Symbol(id));
      await ctx.plugin(Life, { id, dataDir: dataRoot });

      return {
        ctx,
        dataDir: ctx.life.dataDir,
        body: (platform, selfId) => {
          const body = new FakeIMBody(ctx, platform, selfId);
          ctx.nerve.register(body as Body<unknown>);
          return body;
        },
        install: async (config: Partial<CortexChat.Config> = {}) => {
          const fiber = await ctx.plugin(CortexChat, {
            model: `scripted:${id}`,
            aggregateWindow: 0,
            idleTimeout: 0,
            pacing: { charactersPerSecond: 1_000, maxTotalDelayMs: 0 },
            ...config,
          });
          const cortex = ctx.cortex;
          if (!(cortex instanceof CortexChat)) throw new Error("CortexChat did not bind as the active cortex");
          // Restoration is asynchronous; emitting before it completes races the listeners.
          await cortex.ready;
          return { cortex, dispose: () => fiber.dispose() };
        },
      };
    },
  };
}

// ─── Timing ─────────────────────────────────────────────────────────────────

export async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));
  await Promise.resolve();
}

/**
 * Poll an assertion until a deadline.
 *
 * A turn awaits real file and database I/O, so counting microtask rounds makes
 * the wait depend on how busy the machine is.
 */
export async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let failure: unknown;
  for (;;) {
    try {
      await assertion();
      return;
    } catch (error) {
      failure = error;
    }
    if (Date.now() >= deadline) throw failure;
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}
