import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { AIService, ToolRegistry } from "@athena-ai/core";
import SandboxHub, { SELF_ID } from "@athena-ai/plugin-sandbox";
import SandboxNerve from "@athena-ai/plugin-sandbox-nerve";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { MockProviderV4 } from "ai/test";
import { Context } from "cordis";
import type { Dict } from "cosmokit";
import { describe, expect, it } from "vitest";

import Life from "../../life/src/index.js";
import CortexChat from "../src/index.js";
import type { SceneAddress } from "../src/scene.js";
import { scriptedModel } from "./ai-fixture.js";
import type { ScriptedModel } from "./ai-fixture.js";
import { emptyModelsConfig, waitFor } from "./im-fixture.js";

// ─── Test-only helpers ──────────────────────────────────────────────────────
//
// The sandbox platform lives in a browser tab, so the tab is the only thing
// faked here (plus the language model). Hub, Nerve, SandboxBot, Life, Nerve
// events, CortexChat and its persistence are all real.

const PLATFORM = "sandbox";
const LIFE_ID = "alice";
const BODY_SID = `${PLATFORM}:${SELF_ID}`;
const DIRECT = "@Alice";
const ROOM = "#room";

interface Frame {
  type: string;
  body?: Record<string, unknown>;
}

/** Stands in for a browser tab holding a WebUI socket. */
class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];

  send(payload: Frame): void {
    this.frames.push(payload);
  }

  /** Contents of every chat bubble the page received, in order. */
  bubbles(): string[] {
    return this.frames.filter((frame) => frame.type === "sandbox/message").map((frame) => String(frame.body?.content));
  }
}

/** The slice of `WebUI` the sandbox Hub actually touches. */
class FakeWebUI {
  readonly listeners: Dict<(body?: Record<string, unknown>) => unknown> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);

  addEntry() {
    return {};
  }
}

function scene(channelId: string): SceneAddress {
  return { bodySid: BODY_SID, channelId };
}

/** The `<frame>` projection the model received on one call. */
function frameOf(call: LanguageModelV4CallOptions): string {
  const prompt: LanguageModelV4Prompt = call.prompt;
  for (const message of prompt) {
    if (message.role !== "user") continue;
    for (const part of message.content) {
      if (part.type === "text" && part.text.startsWith("<frame>")) return part.text;
    }
  }
  return "(no frame)";
}

interface SandboxFixture {
  readonly ctx: Context;
  readonly client: FakeClient;
  readonly cortex: CortexChat;
  /** Frozen frame prefix per model call, in order. */
  readonly frames: readonly string[];
  /** Type a message in the page, exactly like the browser client does. */
  type(channel: string, content: string, user?: string): Promise<void>;
  dispose(): Promise<void>;
}

async function createSandboxChat(model: ScriptedModel, config: Partial<CortexChat.Config> = {}): Promise<SandboxFixture> {
  const root = new Context();
  const webui = new FakeWebUI();
  root.provide("webui");
  root.set("webui", webui);

  await root.plugin(Database);
  await root.plugin(MemoryDriver);
  await root.plugin(AIService, { configPath: emptyModelsConfig() });
  await root.plugin(ToolRegistry);
  await root.plugin(SandboxHub, { fileServer: { enabled: false } });
  root.ai.register("scripted", new MockProviderV4({ languageModels: { chat: model } }));

  // One Life group, isolated the way the prelude isolates it.
  const ctx = root.isolate("life", Symbol(LIFE_ID)).isolate("cortex", Symbol(LIFE_ID)).isolate("nerve", Symbol(LIFE_ID));
  await ctx.plugin(Life, { id: LIFE_ID, dataDir: mkdtempSync(path.join(tmpdir(), "athena-chat-e2e-life-")) });
  await ctx.plugin(SandboxNerve);
  const fiber = await ctx.plugin(CortexChat, {
    model: "scripted:chat",
    aggregateWindow: 0,
    idleTimeout: 0,
    pacing: { charactersPerSecond: 1_000, maxTotalDelayMs: 0 },
    ...config,
  });

  const cortex = ctx.cortex;
  if (!(cortex instanceof CortexChat)) throw new Error("CortexChat did not bind as the active cortex");
  // Restoration is asynchronous; typing before it completes races the listeners.
  await cortex.ready;

  const client = new FakeClient();
  webui.clients[client.id] = client;

  return {
    ctx,
    client,
    cortex,
    get frames(): readonly string[] {
      return model.calls.map(frameOf);
    },
    type: async (channel, content, user = "Alice") => {
      const listener = webui.listeners["sandbox/send-message"];
      if (!listener) throw new Error("the sandbox Hub registered no send-message listener");
      await listener.call(client, { lifeId: LIFE_ID, platform: PLATFORM, user, channel, content });
    },
    dispose: () => fiber.dispose(),
  };
}

/** Everything the archive holds for one Scene, oldest first. */
async function archived(cortex: CortexChat, channelId: string): Promise<string[]> {
  const stored = await cortex.messages.readScene(scene(channelId));
  return stored.map((message) => `${message.userId}: ${message.content}`);
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("sandbox end to end", () => {
  it("carries a direct message from the page through the turn and back into the archive", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["on my way"] } }]);
    const chat = await createSandboxChat(model);

    await chat.type(DIRECT, "are you there?");

    // sandbox message → message-created → route → turn → send_message → bubble
    await waitFor(() => {
      expect(chat.client.bubbles()).toEqual(["are you there?", "on my way"]);
    });
    // The first trigger adopted its Scene, so `send_message` needed no target.
    expect(chat.cortex.attention.snapshot()).toMatchObject({ frameFocus: scene(DIRECT), logicalFocus: scene(DIRECT) });

    // Inbound and the Life's own reply are both in the objective archive.
    await waitFor(async () => {
      expect(await archived(chat.cortex, DIRECT)).toEqual(["Alice: are you there?", `${SELF_ID}: on my way`]);
    });

    const workspace = chat.cortex.workspace;
    const trigger = workspace.find((record) => record.role === "user");
    expect(trigger?.content).toContain('<message from="Alice"');
    expect(trigger?.content).toContain("are you there?");
    expect(JSON.stringify(workspace)).toContain("send_message");

    await chat.dispose();
  });

  it("triggers on an @self mention in a channel and ignores an unrelated channel message", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["here"] } }]);
    const chat = await createSandboxChat(model);

    await chat.type(ROOM, "morning everyone", "Bob");
    await chat.type(ROOM, `<at id="${SELF_ID}"/> what do you think?`);

    await waitFor(() => {
      expect(chat.client.bubbles().at(-1)).toBe("here");
    });
    // The unrelated message was archived without ever reaching a turn.
    expect(await archived(chat.cortex, ROOM)).toEqual(["Bob: morning everyone", `Alice: <at id="${SELF_ID}"/> what do you think?`, `${SELF_ID}: here`]);
    expect(model.calls).toHaveLength(1);

    await chat.dispose();
  });

  it("keeps an ordinary message in the focus Scene out of the turn stream", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "nothing to add" } }]);
    const chat = await createSandboxChat(model, { initialFocus: `${encodeURIComponent(BODY_SID)}/${encodeURIComponent(ROOM)}` });

    await chat.type(ROOM, "just chatting", "Bob");

    await waitFor(() => {
      const workspace = chat.cortex.workspace;
      expect(workspace.map((record) => record.role)).toEqual(["user"]);
      expect(workspace[0]?.content).toContain("just chatting");
      expect(workspace[0]?.content).toContain('<message from="Bob"');
    });
    expect(model.calls).toHaveLength(0);
    expect(chat.client.bubbles()).toEqual(["just chatting"]);

    await chat.dispose();
  });

  it("reports a non-focus trigger as awareness and lets peek_channel read it", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "peek_channel", input: { target: scene(ROOM), limit: 5 } },
      { kind: "tool", toolName: "wait", input: { reason: "already handled" } },
    ]);
    const chat = await createSandboxChat(model, { initialFocus: `${encodeURIComponent(BODY_SID)}/${encodeURIComponent(DIRECT)}` });

    await chat.type(ROOM, `<at id="${SELF_ID}"/> ping from the room`);

    await waitFor(() => {
      expect(model.calls).toHaveLength(2);
    });

    // Awareness does not move the focus, and the peek reports canonical content.
    expect(chat.cortex.attention.snapshot().frameFocus).toEqual(scene(DIRECT));
    const persisted = JSON.stringify(chat.cortex.workspace);
    expect(persisted).toContain("ping from the room");
    expect(persisted).toContain("peek_channel");
    await chat.dispose();
  });

  it("delivers to the switched focus while the turn keeps its frozen frame", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "switch_focus", input: { target: scene(ROOM), reason: "the room is more urgent" } },
      { kind: "tool", toolName: "send_message", input: { messages: ["moving over"], continue: true } },
      { kind: "tool", toolName: "wait", input: { reason: "done" } },
    ]);
    const chat = await createSandboxChat(model);

    await chat.type(DIRECT, "anything happening in the room?");

    await waitFor(() => {
      expect(model.calls).toHaveLength(3);
    });

    // `send_message` had no target, so it followed the switched logical focus.
    expect(chat.client.bubbles()).toEqual(["anything happening in the room?", "moving over"]);
    expect(chat.cortex.attention.snapshot()).toMatchObject({ frameFocus: scene(ROOM), logicalFocus: scene(ROOM) });
    // One turn, one frozen frame; the committed checkpoint is promoted after the turn.
    expect(new Set(chat.frames).size).toBe(1);
    expect(chat.frames[0]).toContain(DIRECT);
    expect(JSON.stringify(chat.cortex.workspace)).toContain("focusChange");

    await chat.dispose();
  });

  it("ends the turn on a non-continuing send_message", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["one", "two"], continue: false } }]);
    const chat = await createSandboxChat(model);

    await chat.type(DIRECT, "two lines please");

    await waitFor(() => {
      expect(chat.client.bubbles()).toEqual(["two lines please", "one", "two"]);
    });
    // No further model step after a terminal send.
    expect(model.calls).toHaveLength(1);
    await waitFor(async () => {
      expect(await archived(chat.cortex, DIRECT)).toEqual(["Alice: two lines please", `${SELF_ID}: one`, `${SELF_ID}: two`]);
    });

    await chat.dispose();
  });
});
