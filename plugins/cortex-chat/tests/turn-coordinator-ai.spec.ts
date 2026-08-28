import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import type { LanguageModelV4CallOptions, LanguageModelV4Prompt } from "@ai-sdk/provider";
import { AIService, ToolRegistry, jsonSchema, tool } from "@athena-ai/core";
import type { ModelMessage, UserModelMessage } from "@athena-ai/core";
import type { Body } from "@athena-ai/protocol";
import { Channel, IMBody } from "@athena-ai/protocol-im";
import type { Message } from "@athena-ai/protocol-im";
import type { Fragment } from "@cordisjs/element";
import Database from "@cordisjs/plugin-database";
import MemoryDriver from "@cordisjs/plugin-database-memory";
import { MockProviderV4 } from "ai/test";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import Life from "../../life/src/index.js";
import { Attention } from "../src/attention.js";
import { CheckpointStore, createCheckpoint } from "../src/checkpoint.js";
import type { Checkpoint } from "../src/checkpoint.js";
import type { CortexChatConfig } from "../src/config.js";
import { MessageStore } from "../src/message-store.js";
import { createProductionRunner } from "../src/runner.js";
import type { SceneAddress } from "../src/scene.js";
import { TurnCoordinator } from "../src/turn-coordinator.js";
import type { TurnInput } from "../src/turn-coordinator.js";
import { scriptedModel } from "./ai-fixture.js";
import type { ScriptedModel } from "./ai-fixture.js";

// ─── Test-only helpers ──────────────────────────────────────────────────────

function scene(bodySid: string, channelId: string): SceneAddress {
  return { bodySid, channelId };
}

let messageSeq = 0;

function workspaceUser(content: string): UserModelMessage {
  messageSeq += 1;
  return { role: "user", content };
}

function input(content: string): TurnInput {
  return { messages: [workspaceUser(content)], cause: "message" };
}

/** Real IMBody that records outbound fragments instead of reaching a platform. */
class FakeIMBody extends IMBody<unknown> {
  public override platform: string;
  public readonly sent: Array<{ channelId: string; fragment: Fragment }> = [];

  constructor(ctx: Context, platform: string, selfId: string) {
    super(ctx, undefined);
    this.platform = platform;
    this.selfId = selfId;
    this.status = "online";
  }

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async createMessage(channelId: string, content: Fragment): Promise<Message[]> {
    this.sent.push({ channelId, fragment: content });
    return [{ id: `mid-${this.sent.length}`, content: String(content) }];
  }

  async createDirectChannel(userId: string): Promise<Channel> {
    return { id: `@${userId}`, type: Channel.Type.DIRECT };
  }
}

/** AIService refuses a configured path that does not exist, so write an empty registry. */
function emptyModelsConfig(): string {
  const filePath = path.join(mkdtempSync(path.join(tmpdir(), "athena-chat-models-")), "models.yml");
  writeFileSync(filePath, "", "utf8");
  return filePath;
}

function testConfig(overrides: Partial<CortexChatConfig> = {}): CortexChatConfig {
  return {
    model: "scripted:chat",
    compactModel: "",
    maxSteps: 8,
    aggregateWindow: 0,
    compactThreshold: 8_000,
    idleTimeout: 0,
    initialFocus: "",
    pacing: { charactersPerSecond: 1_000, maxTotalDelayMs: 0 },
    customInnerThought: true,
    focusHistoryLimit: 30,
    toolOutputMaxChars: 1_000,
    toolOutputHeadChars: 400,
    toolOutputTailChars: 400,
    ...overrides,
  };
}

/** The `<frame>` projection the model actually received on one call. */
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

interface RunnerFixture {
  readonly ctx: Context;
  readonly coordinator: TurnCoordinator;
  readonly workspace: ModelMessage[];
  readonly messages: MessageStore;
  /** Frozen frame prefix per model call, in order. */
  readonly frameSnapshots: readonly string[];
  body(sid: string): FakeIMBody;
}

async function createRunnerFixture(model: ScriptedModel, options: { focus?: SceneAddress } = {}): Promise<RunnerFixture> {
  const ctx = new Context();
  await ctx.plugin(Database);
  await ctx.plugin(MemoryDriver);
  await ctx.plugin(AIService, { configPath: emptyModelsConfig() });
  await ctx.plugin(ToolRegistry);
  await ctx.plugin(Life, { id: "alice", dataDir: mkdtempSync(path.join(tmpdir(), "athena-chat-life-")) });

  ctx.ai.register("scripted", new MockProviderV4({ languageModels: { chat: model } }));

  const body = new FakeIMBody(ctx, "sandbox", "alice");
  const bodies: Record<string, FakeIMBody> = { [body.sid]: body };
  ctx.nerve.register(body as Body<unknown>);

  const messages = new MessageStore(ctx, ctx.life.id);
  const workspace: ModelMessage[] = [];
  const checkpointStore = new CheckpointStore(ctx);
  const focus = options.focus ?? scene(body.sid, "general");
  const attention = new Attention({ store: messages, initialFocus: focus });
  const coordinator = new TurnCoordinator({ workspace, aggregateWindow: 0 });

  let checkpoint: Checkpoint = createCheckpoint({ focus, history: [], lastFocusHistory: [], compaction: null });
  coordinator.bindRunner(
    createProductionRunner({
      ctx,
      workspace,
      messages,
      attention,
      coordinator,
      checkpointStore,
      getCheckpoint: () => checkpoint,
      setCheckpoint: (next) => {
        checkpoint = next;
      },
      config: testConfig(),
      logger: ctx.logger("cortex-chat-test"),
    }),
  );

  return {
    ctx,
    coordinator,
    workspace,
    messages,
    get frameSnapshots(): readonly string[] {
      return model.calls.map(frameOf);
    },
    body: (sid) => {
      const found = bodies[sid];
      if (!found) throw new Error(`test body not registered: ${sid}`);
      return found;
    },
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("production runner", () => {
  it("executes a multi-step tool loop and persists complete response content", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "peek_channel", input: { target: scene("sandbox:alice", "other"), limit: 5 } },
      { kind: "text", text: "I checked the other channel.", reasoning: "The focus is still useful." },
    ]);
    const cortex = await createRunnerFixture(model);

    await expect(cortex.coordinator.submit(input("check")).done).resolves.toMatchObject({ status: "completed" });

    const persisted = JSON.stringify(cortex.workspace);
    expect(persisted).toContain("The focus is still useful.");
    expect(persisted).toContain("peek_channel");
    expect(persisted).toContain("I checked the other channel.");
    expect(model.calls).toHaveLength(2);
  });

  it("pairs every tool call with a tool result and keeps provider metadata", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "peek_channel", input: { target: scene("sandbox:alice", "other"), limit: 5 } },
      { kind: "text", text: "done", reasoning: "checked" },
    ]);
    const cortex = await createRunnerFixture(model);
    await cortex.coordinator.submit(input("check")).done;

    const records = cortex.workspace;
    const assistant = records.find(
      (record) => record.role === "assistant" && Array.isArray(record.content) && record.content.some((part) => part.type === "tool-call"),
    );
    const tool = records.find((record) => record.role === "tool");
    expect(assistant).toBeDefined();
    expect(tool).toBeDefined();

    const call = Array.isArray(assistant?.content) ? assistant.content.find((part) => part.type === "tool-call") : undefined;
    const result = Array.isArray(tool?.content) ? tool.content.find((part) => part.type === "tool-result") : undefined;
    expect(call?.type === "tool-call" ? call.toolCallId : null).toBe(result?.type === "tool-result" ? result.toolCallId : undefined);
    expect(call?.type === "tool-call" ? call.input : null).toMatchObject({ limit: 5 });
    expect(call?.type === "tool-call" ? call.providerOptions : null).toMatchObject({ scripted: { step: 1 } });
    expect(result?.type === "tool-result" ? result.output : null).toMatchObject({ type: "json" });
  });

  it("stops after wait without a further model step", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "wait", input: { reason: "not urgent" } }]);
    const cortex = await createRunnerFixture(model);

    await expect(cortex.coordinator.submit(input("wait")).done).resolves.toMatchObject({ status: "completed", delivered: false });
    expect(model.calls).toHaveLength(1);
  });

  it("stops after a non-continuing send_message and reports delivery", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "send_message", input: { messages: ["hi"] } }]);
    const cortex = await createRunnerFixture(model);

    await expect(cortex.coordinator.submit(input("hello")).done).resolves.toMatchObject({ status: "completed", delivered: true });
    expect(model.calls).toHaveLength(1);
    expect(cortex.body("sandbox:alice").sent).toHaveLength(1);
  });

  it("returns failed instead of swallowing a model error", async () => {
    const model = scriptedModel([{ kind: "error", error: new Error("provider unavailable") }]);
    const cortex = await createRunnerFixture(model);

    await expect(cortex.coordinator.submit(input("fail")).done).resolves.toMatchObject({
      status: "failed",
      error: expect.objectContaining({ message: "provider unavailable" }),
    });
  });

  it("keeps the frozen frame while switch_focus changes the default target", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "switch_focus", input: { target: scene("sandbox:alice", "other"), reason: "urgent" } },
      { kind: "tool", toolName: "send_message", input: { messages: ["on my way"] } },
    ]);
    const cortex = await createRunnerFixture(model);

    await cortex.coordinator.submit(input("switch")).done;

    expect(cortex.frameSnapshots).toHaveLength(2);
    expect(cortex.frameSnapshots.every((frame) => frame === cortex.frameSnapshots[0])).toBe(true);
    expect(cortex.frameSnapshots[0]).toContain('channelId="general"');
    expect(cortex.body("sandbox:alice").sent).toHaveLength(1);
    expect(cortex.body("sandbox:alice").sent[0]!.channelId).toBe("other");
    const assistantIndex = cortex.workspace.findIndex(
      (message) =>
        message.role === "assistant" &&
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "tool-call" && part.toolName === "switch_focus"),
    );
    const focusChangeIndex = cortex.workspace.findIndex(
      (message) => message.role === "system" && typeof message.content === "string" && message.content.includes("<focusChange"),
    );
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(focusChangeIndex).toBeGreaterThan(assistantIndex);
  });

  it("joins messages that arrive during an active turn at the next step boundary", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "peek_channel", input: { target: scene("sandbox:alice", "other"), limit: 1 } },
      { kind: "text", text: "acknowledged", reasoning: "later message seen" },
    ]);
    const cortex = await createRunnerFixture(model);

    const admission = cortex.coordinator.submit(input("first"));
    const joined = cortex.coordinator.submit(input("joined-while-running"));
    expect(joined.kind).toBe("joined");
    await admission.done;

    const secondCallPrompt = JSON.stringify(model.calls[1]?.prompt);
    expect(secondCallPrompt).toContain("joined-while-running");
  });
  it("reassembles tools and persona from current state on every turn", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "wait", input: { reason: "first" } },
      { kind: "tool", toolName: "wait", input: { reason: "second" } },
    ]);
    const cortex = await createRunnerFixture(model);
    cortex.ctx.life.persona = "persona-v1";

    await cortex.coordinator.submit(input("first turn")).done;
    await new Promise<void>((resolve) => setImmediate(resolve));
    const unregister = cortex.ctx.tools.register(
      "dynamic_probe",
      tool({ description: "dynamic test tool", inputSchema: jsonSchema({ type: "object", properties: {} }) }),
    );
    cortex.ctx.life.persona = "persona-v2";
    const second = cortex.coordinator.submit(input("second turn"));
    expect(second.kind).toBe("started");
    const secondResult = await second.done;
    if (secondResult.status === "failed") throw secondResult.error;
    expect(secondResult).toMatchObject({ status: "completed" });

    const firstTools = model.calls[0]?.tools?.map((entry) => entry.name) ?? [];
    const secondTools = model.calls[1]?.tools?.map((entry) => entry.name) ?? [];
    expect(firstTools).not.toContain("dynamic_probe");
    expect(model.calls).toHaveLength(2);
    expect(secondTools).toContain("dynamic_probe");
    expect(JSON.stringify(model.calls[0]?.prompt)).toContain("persona-v1");
    expect(JSON.stringify(model.calls[1]?.prompt)).toContain("persona-v2");
    unregister();
  });
  it("keeps the stable and frame prompt bytes across consecutive turns without rebuild", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "wait", input: { reason: "first" } },
      { kind: "tool", toolName: "wait", input: { reason: "second" } },
    ]);
    const cortex = await createRunnerFixture(model);

    await cortex.coordinator.submit(input("first turn")).done;
    await cortex.coordinator.submit(input("second turn")).done;

    expect(cortex.frameSnapshots).toHaveLength(2);
    expect(cortex.frameSnapshots[0]).toBe(cortex.frameSnapshots[1]);
  });
});
