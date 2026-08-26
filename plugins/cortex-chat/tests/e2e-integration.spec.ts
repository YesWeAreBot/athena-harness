import { tool } from "@ai-sdk/provider-utils";
import { Context, Service } from "cordis";
import { describe, expect, it } from "vitest";

import { Attention } from "../src/attention.js";
import { AgentLoop } from "../src/loop.js";
import { TurnQueue } from "../src/queue.js";
import { type WsMessage, createWsMessage, WorkspaceStore } from "../src/workspace-store.js";

class FakeAI extends Service {
  constructor(ctx: Context) {
    super(ctx, "ai");
  }
  language() {
    return { modelId: "mock" } as unknown as never;
  }
}

describe("e2e — sandbox message flow without model", () => {
  it("archives → routes → queues → workspaces", async () => {
    const ctx = new Context();
    const workspace = new WorkspaceStore(ctx);
    const queue = new TurnQueue(ctx);
    const store = {
      getByChannel: async () => [],
      getByUser: async () => [],
      store: async () => {},
    } as never;
    const att = new Attention({ store, initialFocus: null });
    const loop = new AgentLoop({
      ctx,
      workspace,
      messageStore: store as never,
      queue,
      turnQueue: queue,
      system: "you are test",
      compaction: null,
      focusSceneId: null,
      model: {} as never,
      maxSteps: 2,
    });

    // First trigger establishes focus and triggers a turn
    const ev = {
      platform: "sandbox",
      channelId: "general",
      userId: "alice",
      selfId: "athena",
      content: "hello @athena",
      isDirect: false,
      elements: [{ type: "at", attrs: { id: "athena" }, children: [] }],
    } as never;
    const routed = await att.route(ev);
    expect(routed.kind).toBe("trigger");
    // SAFETY: route() returns trigger with messages field populated
    await loop.run((routed as { messages: WsMessage[] }).messages);
    const all = await workspace.readAll();
    expect(all.length).toBeGreaterThanOrEqual(1);
  });
});

describe("multi-Life isolation — tools not leaking", () => {
  it("same-name tools in two Lives do not cross", async () => {
    const { ToolRegistry } = await import("@athena-ai/core"); // test: exercise module loading boundary
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const fakeLife = (id: string) => {
      const child = ctx.isolate("life");
      // SAFETY: Cordis internal — reflect.provide accepts service name + instance
      (child as unknown as { reflect: { provide(n: string, svc: never): void } }).reflect.provide("life", {
        id,
        persona: "",
        cortex: null,
        bind() {
          return () => {};
        },
      } as never);
      return child;
    };
    const alice = fakeLife("alice");
    const bob = fakeLife("bob");
    const tA = tool({ description: "a", inputSchema: { type: "object", properties: {} } as never });
    const tB = tool({ description: "b", inputSchema: { type: "object", properties: {} } as never });
    alice.tools.register("shared", tA);
    bob.tools.register("shared", tB);
    expect(alice.tools.available()["shared"]).toBe(tA);
    expect(bob.tools.available()["shared"]).toBe(tB);
    expect(ctx.tools.available()["shared"]).toBeUndefined();
  });
});
