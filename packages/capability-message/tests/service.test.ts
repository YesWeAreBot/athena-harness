import type { Bot, Session } from "@satorijs/core";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import MessageService from "../src/index.js";

/** Build the arrangement the runtime uses: the group owns the isolation. */
function createDomain() {
  const ctx = new Context();
  const inner = ctx.isolate("satori").isolate("bots");
  return { ctx, inner };
}

describe("MessageService", () => {
  it("provides ctx.message when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    expect(ctx.message).toBeInstanceOf(MessageService);
  });

  it("group isolation hides satori outside while message stays visible", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    // satori lives in the group's isolate — invisible to the outer context
    expect(ctx.get("satori")).toBeUndefined();
    // the capability itself is still exposed to consumers
    expect(ctx.get("message")).toBeInstanceOf(MessageService);
  });

  it("bots returns empty array initially", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    expect(ctx.message.bots).toHaveLength(0);
  });

  it("bots resolves through the captured ctx when reached from outside", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    inner.get("satori")!.bots.push({ sid: "fake:1", isActive: true } as unknown as Bot);
    // ctx.get() rebinds this.ctx on the traceable proxy, and the caller's ctx
    // cannot resolve `satori` — the service must use its own captured ctx
    expect(ctx.get("message")!.bots).toHaveLength(1);
  });

  it("_resolveBot throws when no bots", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    await expect(ctx.message.sendMessage("ch1", "hello")).rejects.toThrow("No active bots available");
  });

  it("a sibling plugin in the same isolate domain registers its bot", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});

    const fakeBot = { sid: "fake:1", isActive: true } as unknown as Bot;
    function fakeAdapter(adapterCtx: Context) {
      // Sibling entries resolve the capability's satori through the group isolate
      adapterCtx.bots.push(fakeBot);
    }
    fakeAdapter.inject = ["satori"];
    await inner.plugin(fakeAdapter);

    expect(ctx.message.bots).toHaveLength(1);
    expect(ctx.message.bots[0].sid).toBe("fake:1");
  });

  it("Context.filter is injected on sessions via internal/session", async () => {
    const ctx = new Context();
    await ctx.plugin(MessageService, {});
    // Simulate a session dispatch on the context the service was plugged into
    const mockSession: Record<symbol | string, unknown> = {};
    ctx.emit("internal/session", mockSession);
    expect(typeof mockSession[Context.filter]).toBe("function");
  });

  it("session filter passes for contexts sharing the message isolate", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    const mockSession: Record<symbol | string, unknown> = {};
    inner.emit("internal/session", mockSession);
    const filter = mockSession[Context.filter] as (ctx: Context) => boolean;
    // The outer ctx shares the same message symbol — message is not isolated here
    expect(filter(ctx)).toBe(true);
  });

  it("session filter rejects contexts in a different message isolate", async () => {
    const { ctx, inner } = createDomain();
    await inner.plugin(MessageService, {});
    const mockSession: Record<symbol | string, unknown> = {};
    inner.emit("internal/session", mockSession);
    const filter = mockSession[Context.filter] as (ctx: Context) => boolean;
    expect(filter(ctx.isolate("message"))).toBe(false);
  });
});
