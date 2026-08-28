import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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

const PLATFORM = "sandbox";
const BODY_SID = `${PLATFORM}:${SELF_ID}`;
const CHANNEL = "@Alice";

interface Frame {
  type: string;
  body?: Record<string, unknown>;
}

class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];

  send(payload: Frame): void {
    this.frames.push(payload);
  }

  bubbles(): string[] {
    return this.frames.filter((frame) => frame.type === "sandbox/message").map((frame) => String(frame.body?.content));
  }
}

class FakeWebUI {
  readonly listeners: Dict<(body?: Record<string, unknown>) => unknown> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);

  addEntry() {
    return {};
  }
}

interface LifeFixture {
  readonly ctx: Context;
  readonly cortex: CortexChat;
  readonly model: ScriptedModel;
  dispose(): Promise<void>;
}

function scene(): SceneAddress {
  return { bodySid: BODY_SID, channelId: CHANNEL };
}

async function installLife(root: Context, id: string, model: ScriptedModel, dataRoot: string): Promise<LifeFixture> {
  const ctx = root.isolate("life", Symbol(id)).isolate("cortex", Symbol(id)).isolate("nerve", Symbol(id));
  await ctx.plugin(Life, { id, dataDir: dataRoot });
  await ctx.plugin(SandboxNerve);
  const fiber = await ctx.plugin(CortexChat, {
    model: `scripted:${id}`,
    aggregateWindow: 0,
    idleTimeout: 0,
    pacing: { charactersPerSecond: 1_000, maxTotalDelayMs: 0 },
  });
  const cortex = ctx.cortex;
  if (!(cortex instanceof CortexChat)) throw new Error(`CortexChat did not activate for ${id}`);
  await cortex.ready;
  return { ctx, cortex, model, dispose: () => fiber.dispose() };
}

describe("multi-Life sandbox topology", () => {
  it("routes one browser message only to the selected Life with a shared Body sid", async () => {
    const root = new Context();
    const webui = new FakeWebUI();
    root.provide("webui");
    root.set("webui", webui);
    await root.plugin(Database);
    await root.plugin(MemoryDriver);
    await root.plugin(AIService, { configPath: emptyModelsConfig() });
    await root.plugin(ToolRegistry);
    await root.plugin(SandboxHub, { fileServer: { enabled: false } });

    const aliceModel = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["alice reply"] } }]);
    const bobModel = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["bob reply"] } }]);
    root.ai.register("scripted", new MockProviderV4({ languageModels: { alice: aliceModel, bob: bobModel } }));

    const dataRoot = mkdtempSync(path.join(tmpdir(), "athena-chat-multi-life-sandbox-"));
    const alice = await installLife(root, "alice", aliceModel, dataRoot);
    const bob = await installLife(root, "bob", bobModel, dataRoot);

    const client = new FakeClient();
    webui.clients[client.id] = client;
    const listener = webui.listeners["sandbox/send-message"];
    if (!listener) throw new Error("the sandbox Hub registered no send-message listener");
    await listener.call(client, { lifeId: "alice", platform: PLATFORM, user: "Alice", channel: CHANNEL, content: "hello alice" });

    await waitFor(() => {
      expect(client.bubbles()).toEqual(["hello alice", "alice reply"]);
    });
    expect(alice.model.calls).toHaveLength(1);
    expect(bob.model.calls).toHaveLength(0);
    await waitFor(async () => {
      expect((await alice.cortex.messages.readScene(scene())).map((message) => message.content)).toEqual(["hello alice", "alice reply"]);
    });
    expect(await bob.cortex.messages.readScene(scene())).toEqual([]);
    expect(bob.cortex.workspace).toEqual([]);

    await listener.call(client, { lifeId: "bob", platform: PLATFORM, user: "User", channel: "#idle", content: "background only" });
    await waitFor(() => {
      expect(alice.ctx.nerve.get(BODY_SID)).toBeDefined();
      expect(bob.ctx.nerve.get(BODY_SID)).toBeDefined();
    });
    expect(alice.ctx.nerve.get(BODY_SID)).not.toBe(bob.ctx.nerve.get(BODY_SID));
    expect(bob.model.calls).toHaveLength(0);

    await alice.dispose();
    await bob.dispose();
  });
});
