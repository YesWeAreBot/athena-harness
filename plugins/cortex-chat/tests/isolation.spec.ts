import { tool } from "@ai-sdk/provider-utils";
import type { UserModelMessage } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { createCheckpoint } from "../src/checkpoint.js";
import type { SceneAddress } from "../src/scene.js";
import { scriptedModel } from "./ai-fixture.js";
import { createHarness, waitFor } from "./im-fixture.js";

// ─── Test-only helpers ──────────────────────────────────────────────────────

function scene(bodySid: string, channelId: string): SceneAddress {
  return { bodySid, channelId };
}

function workspaceUser(content: string): UserModelMessage {
  return { role: "user", content };
}

function emptyTool(description: string) {
  return tool({ description, inputSchema: { type: "object", properties: {} } as never });
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("multi-Life isolation", () => {
  it("keeps workspace and checkpoint apart under a shared data root and database", async () => {
    const harness = await createHarness({ alice: scriptedModel([]), bob: scriptedModel([]) });
    const alice = await (await harness.life("alice")).install();
    const bobLife = await harness.life("bob");
    const bob = await bobLife.install();

    const shared = scene("onebot:100", "general");
    alice.cortex.workspace.push(workspaceUser("alice data"));
    await alice.cortex.checkpointStore.save(createCheckpoint({ focus: shared, history: [], lastFocusHistory: [], compaction: "alice summary" }));

    expect(bob.cortex.workspace).toHaveLength(0);
    await expect(bob.cortex.checkpointStore.load()).resolves.toBeNull();
    // Both Lives were configured with one data root; the Life derives the split.
    expect(bobLife.dataDir).not.toBe((await harness.life("alice")).dataDir);

    await alice.dispose();
    await bob.dispose();
  });

  it("keeps the message archive apart for two Lives sharing one bodySid", async () => {
    const harness = await createHarness({ alice: scriptedModel([]), bob: scriptedModel([]) });
    const aliceLife = await harness.life("alice");
    const bobLife = await harness.life("bob");
    // Two Lives can each own a login with the same sid; the archive must not merge them.
    const aliceBody = aliceLife.body("onebot", "100");
    bobLife.body("onebot", "100");
    const alice = await aliceLife.install();
    const bob = await bobLife.install();

    aliceBody.receive({ channelId: "general", content: "only alice heard this", messageId: "in-1" });

    const shared = scene("onebot:100", "general");
    await waitFor(async () => {
      expect(await alice.cortex.messages.readScene(shared)).toEqual([expect.objectContaining({ content: "only alice heard this" })]);
    });
    expect(await bob.cortex.messages.readScene(shared)).toEqual([]);

    await alice.dispose();
    await bob.dispose();
  });

  it("does not leak same-name tools between Lives", async () => {
    const harness = await createHarness({ alice: scriptedModel([]), bob: scriptedModel([]) });
    const aliceLife = await harness.life("alice");
    const bobLife = await harness.life("bob");

    const aliceTool = emptyTool("alice");
    const bobTool = emptyTool("bob");
    aliceLife.ctx.tools.register("shared", aliceTool);
    bobLife.ctx.tools.register("shared", bobTool);

    expect(aliceLife.ctx.tools.available()["shared"]).toBe(aliceTool);
    expect(bobLife.ctx.tools.available()["shared"]).toBe(bobTool);
    expect(harness.root.tools.available()["shared"]).toBeUndefined();
  });
});

describe("multi-Body routing", () => {
  it("routes identical channel ids through different Body sids", async () => {
    const model = scriptedModel([
      { kind: "tool", toolName: "send_message", input: { target: scene("onebot:100", "42"), messages: ["A"], continue: true } },
      { kind: "tool", toolName: "send_message", input: { target: scene("onebot:200", "42"), messages: ["B"] } },
    ]);
    const harness = await createHarness({ carol: model });
    const life = await harness.life("carol");
    const first = life.body("onebot", "100");
    const second = life.body("onebot", "200");
    const { cortex, dispose } = await life.install();

    // A mention in channel 42 of the first Body: same channel id as the second Body's.
    first.receive({ channelId: "42", content: `<at id="100"/> ping`, messageId: "in-1", direct: false });

    await waitFor(() => {
      expect(second.sent).toHaveLength(1);
    });
    expect(first.sent).toEqual([{ channelId: "42", content: "A" }]);
    expect(second.sent).toEqual([{ channelId: "42", content: "B" }]);

    // Each Body's channel 42 is its own Scene in the archive.
    await waitFor(async () => {
      expect(await cortex.messages.readScene(scene("onebot:200", "42"))).toEqual([expect.objectContaining({ content: "B" })]);
    });
    expect((await cortex.messages.readScene(scene("onebot:100", "42"))).map((message) => message.content)).toEqual([`<at id="100"/> ping`, "A"]);

    await dispose();
  });

  it("reports a structured failure instead of a fabricated id when the target Body is absent", async () => {
    const model = scriptedModel([{ kind: "tool", toolName: "send_message", input: { target: scene("onebot:404", "42"), messages: ["nowhere"] } }]);
    const harness = await createHarness({ carol: model });
    const life = await harness.life("carol");
    const body = life.body("onebot", "100");
    const { cortex, dispose } = await life.install();

    body.receive({ channelId: "@u1", content: "are you there?", messageId: "in-1" });

    await waitFor(async () => {
      const persisted = JSON.stringify(cortex.workspace);
      expect(persisted).toContain("BodyNotFound");
      expect(persisted).toContain("onebot:404");
    });
    expect(body.sent).toEqual([]);
    expect(JSON.stringify(cortex.workspace)).not.toContain("mock:");
    await dispose();
  });
});
