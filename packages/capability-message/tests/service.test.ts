import { Context } from "cordis";
import { describe, it, expect } from "vitest";

import { MessageService } from "../src/service";

describe("MessageService", () => {
  it("provides ctx.message when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    expect(ctx.message).toBeInstanceOf(MessageService);
  });

  it("creates isolation domain — ctx.satori is undefined outside", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    // satori should NOT be visible on the outer context
    expect(ctx.get("satori")).toBeUndefined();
  });

  it("bots returns empty array initially", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    expect(ctx.message.bots).toHaveLength(0);
  });

  it("_resolveBot throws when no bots", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    await expect(ctx.message.sendMessage("ch1", "hello")).rejects.toThrow("No active bots available");
  });

  it("adapter() installs plugin into isolation domain", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    let installed = false;
    function fakeAdapter(_ctx: Context) {
      installed = true;
    }
    ctx.message.adapter(fakeAdapter);
    // Fiber activation is async in cordis v4 — await the inner context's plugin
    const inner: Context = Reflect.get(ctx.message, "_inner");
    // Wait for all pending fibers to settle
    for (const runtime of inner.registry.values()) {
      for (const fiber of runtime.fibers) {
        await fiber.await().catch(() => {});
      }
    }
    expect(installed).toBe(true);
  });

  it("Context.filter is injected on sessions via internal/session", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    const inner: Context = Reflect.get(ctx.message, "_inner");
    // Simulate a session dispatch
    const mockSession: Record<symbol | string, unknown> = {};
    inner.emit("internal/session", mockSession);
    expect(typeof mockSession[Context.filter]).toBe("function");
  });

  it("session filter passes for contexts sharing the message isolate", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    const inner: Context = Reflect.get(ctx.message, "_inner");
    const mockSession: Record<symbol | string, unknown> = {};
    inner.emit("internal/session", mockSession);
    const filter = mockSession[Context.filter] as (ctx: Context) => boolean;
    // The outer ctx should share the same message symbol
    expect(filter(ctx)).toBe(true);
  });
});
