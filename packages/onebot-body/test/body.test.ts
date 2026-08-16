import { BodyRegistry } from "@yesimbot/athena-runtime";
import type { PerceptEvent } from "@yesimbot/athena-runtime";
import { Context } from "cordis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OneBotBodyAdapter, resolveOneBotConfig } from "../src/index.js";

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(
    url: string,
    private readonly autoOpen = true,
  ) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    if (autoOpen) {
      queueMicrotask(() => this.emit("open"));
    }
  }

  addEventListener(type: string, listener: (event: unknown) => void, options?: { once?: boolean }): void {
    const wrapped = options?.once
      ? (event: unknown) => {
          listener(event);
          this.removeEventListener(type, wrapped);
        }
      : listener;
    const list = this.listeners.get(type) ?? [];
    list.push(wrapped);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      list.filter((item) => item !== listener),
    );
  }

  close(): void {
    queueMicrotask(() => this.emit("close"));
  }

  emit(type: string, event: unknown = {}): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      listener(event);
    }
  }
}

describe("onebot body adapter", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket as unknown as typeof WebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("connects, dispatches percepts, patches state, and stops cleanly", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(BodyRegistry);
    await fiber;

    const percepts: PerceptEvent[] = [];
    const stateChanges: Array<{ id: string; patch: Record<string, unknown> }> = [];
    ctx.on("body/percept", (event) => percepts.push(event));
    ctx.on("body/state-changed", (event) => stateChanges.push(event));

    const adapter = new OneBotBodyAdapter(
      resolveOneBotConfig({
        id: "onebot-test",
        wsUrl: "ws://onebot",
        httpUrl: "http://onebot",
      }),
    );
    const dispose = await ctx.bodies.registerAdapter(adapter);
    const socket = FakeWebSocket.instances.at(-1);

    expect(socket?.url).toBe("ws://onebot/");
    expect(ctx.bodies.get("onebot-test")?.state).toMatchObject({ connection: "connected" });

    socket?.emit("message", {
      data: JSON.stringify({
        post_type: "message",
        self_id: 1,
        message_type: "private",
        user_id: 100,
        sender: { nickname: "Alice" },
        message: [{ type: "text", data: { text: "hello" } }],
      }),
    });

    expect(percepts).toHaveLength(1);
    expect(percepts[0]).toMatchObject({
      bodyId: "onebot-test",
      kind: "message-created",
      source: "onebot",
      actor: { id: "100", name: "Alice" },
      target: { id: "onebot:1:private:100", kind: "private" },
    });
    expect(stateChanges.some((event) => event.id === "onebot-test" && event.patch.lastEventAt !== undefined)).toBe(true);

    await dispose();

    expect(ctx.bodies.get("onebot-test")).toBeUndefined();
    await fiber.dispose();
  });

  it("executes actuators through OneBot HTTP actions", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok", data: { message_id: 42 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const ctx = new Context();
    const fiber = ctx.plugin(BodyRegistry);
    await fiber;

    const adapter = new OneBotBodyAdapter(
      resolveOneBotConfig({
        id: "onebot",
        wsUrl: "ws://onebot",
        httpUrl: "http://onebot",
      }),
    );
    const dispose = await ctx.bodies.registerAdapter(adapter);

    const result = await ctx.bodies.act("onebot", "send", { userId: 100, message: "hello" });

    expect(result).toMatchObject({ status: "ok", output: { message_id: 42 } });
    expect(fetchMock).toHaveBeenCalledWith("http://onebot/send_msg", expect.objectContaining({ method: "POST" }));

    await dispose();
    await fiber.dispose();
  });

  it("keeps meta events out of the percept pipeline", async () => {
    const ctx = new Context();
    const fiber = ctx.plugin(BodyRegistry);
    await fiber;

    const percepts: PerceptEvent[] = [];
    ctx.on("body/percept", (event) => percepts.push(event));

    const adapter = new OneBotBodyAdapter(
      resolveOneBotConfig({
        id: "onebot",
        wsUrl: "ws://onebot",
        httpUrl: "http://onebot",
      }),
    );
    const dispose = await ctx.bodies.registerAdapter(adapter);
    const socket = FakeWebSocket.instances.at(-1);

    socket?.emit("message", {
      data: JSON.stringify({
        post_type: "meta_event",
        meta_event_type: "heartbeat",
      }),
    });

    expect(percepts).toHaveLength(0);
    expect(ctx.bodies.get("onebot")?.state).toMatchObject({
      connection: "connected",
      lastEventAt: expect.any(Number),
    });

    await dispose();
    await fiber.dispose();
  });

  it("rolls back when the initial WebSocket connection fails", async () => {
    class FailingWebSocket extends FakeWebSocket {
      constructor(url: string) {
        super(url, false);
        queueMicrotask(() => this.emit("error"));
      }
    }
    vi.stubGlobal("WebSocket", FailingWebSocket as unknown as typeof WebSocket);

    const ctx = new Context();
    const fiber = ctx.plugin(BodyRegistry);
    await fiber;
    const adapter = new OneBotBodyAdapter(
      resolveOneBotConfig({
        id: "broken",
        wsUrl: "ws://onebot",
        httpUrl: "http://onebot",
      }),
    );

    await expect(ctx.bodies.registerAdapter(adapter)).rejects.toThrow(/connection failed/);
    expect(ctx.bodies.get("broken")).toBeUndefined();

    await fiber.dispose();
  });
});
