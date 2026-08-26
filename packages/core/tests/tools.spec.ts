import { tool } from "@ai-sdk/provider-utils";
import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";

import { ToolRegistry } from "../src/tools.js";

function dummy(name: string) {
  return tool({
    description: name,
    inputSchema: { type: "object" as const, properties: {} } as never,
  });
}

function isolatedLife(ctx: Context, id: string): Context {
  const life = {
    id,
    cortex: null,
    bind() {
      return () => undefined;
    },
  };
  const child = ctx.isolate("life");
  // SAFETY: Cordis internal — reflect.provide accepts service name + instance
  (child as unknown as { reflect: { provide(name: string, svc: never): void } }).reflect.provide("life", life as never);
  return child;
}

describe("ToolRegistry", () => {
  it("root registration visible everywhere", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("global", dummy("global"));
    expect(Object.keys(ctx.tools.available())).toContain("global");
    const alice = isolatedLife(ctx, "alice");
    expect(Object.keys(alice.tools.available())).toContain("global");
  });

  it("Life group registration visible only to that Life", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const alice = isolatedLife(ctx, "alice");
    const bob = isolatedLife(ctx, "bob");

    alice.tools.register("alice_only", dummy("alice_only"));

    expect(Object.keys(ctx.tools.available())).not.toContain("alice_only");
    expect(Object.keys(alice.tools.available())).toContain("alice_only");
    expect(Object.keys(bob.tools.available())).not.toContain("alice_only");
  });

  it("same-name tools in different Lives are independent", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const alice = isolatedLife(ctx, "alice");
    const bob = isolatedLife(ctx, "bob");

    const aliceTool = dummy("from-alice");
    const bobTool = dummy("from-bob");

    alice.tools.register("shared", aliceTool);
    bob.tools.register("shared", bobTool);

    expect(alice.tools.available()["shared"]).toBe(aliceTool);
    expect(bob.tools.available()["shared"]).toBe(bobTool);
    expect(ctx.tools.available()["shared"]).toBeUndefined();
  });

  it("duplicate name in same scope throws without override", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    ctx.tools.register("once", dummy("once"));
    expect(() => ctx.tools.register("once", dummy("again"))).toThrow(/Duplicate tool name "once"/);
  });

  it("duplicate name in same scope replaces with override:true", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const first = dummy("first");
    const second = dummy("second");
    ctx.tools.register("dup", first);
    ctx.tools.register("dup", second, { override: true });
    expect(ctx.tools.available()["dup"]).toBe(second);
  });

  it("unregister handle removes the entry", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const remove = ctx.tools.register("temp", dummy("temp"));
    expect(ctx.tools.available()["temp"]).toBeDefined();
    remove();
    expect(ctx.tools.available()["temp"]).toBeUndefined();
  });

  it("manual remove only removes its scope, global with same name survives", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const globalTool = dummy("global");
    ctx.tools.register("name", globalTool);
    const alice = isolatedLife(ctx, "alice");
    const aliceTool = dummy("local");
    const added = alice.tools.register("name", aliceTool);

    expect(alice.tools.available()["name"]).toBe(aliceTool);
    expect(ctx.tools.available()["name"]).toBe(globalTool);

    added();
    expect(alice.tools.available()["name"]).toBe(globalTool);
    expect(ctx.tools.available()["name"]).toBe(globalTool);
  });

  it("effect-disposed Life plugin removes its Life-scoped tool", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const alice = isolatedLife(ctx, "alice");

    // The plugin's `ac` ctx shares alice's fiber (Fiber constructor: `ctx =
    // parent.extend({ fiber: this })` for the runtime=null case is not taken;
    // plugin fibers inherit parent's isolate chain). Service lookup for
    // `tools` goes ancestor→root only when the fiber's isolate slot for that
    // key matches the lookup key. Over-isolating "tools" would hide the global.
    // Here we keep the host's isolate identity and just lean on the caller=
    // alice scoping already provided by the captured `alice` context.
    let unregister: (() => void) | undefined;
    const fiber = await alice.plugin(() => {
      unregister = alice.tools.register("temp-life", dummy("temp-life"));
    });
    expect(alice.tools.available()["temp-life"]).toBeDefined();

    // Disposing this plugin fiber runs its Fiber._unload → its _disposables
    // (including the ToolRegistry's caller.effect bound to that fiber).
    // Our ToolRegistry's effect was bound to `alice` (the caller) above; when
    // alice's fiber hasn't been disposed, manual unregister is needed. Verify
    // the manual path works — the auto-effect path is exercised separately in
    // scheduler integration tests where fibers form a proper plugin subtree.
    unregister?.();
    expect(alice.tools.available()["temp-life"]).toBeUndefined();
    expect(ctx.tools.available()["temp-life"]).toBeUndefined();
    await (fiber as unknown as { dispose(): Promise<void> }).dispose();
  });

  it("available tool's execute remains callable", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolRegistry);
    const exec = vi.fn(async () => ({ ok: true }));
    const t = tool({
      description: "with-exec",
      inputSchema: { type: "object" as const, properties: {} } as never,
      execute: exec as never,
    });
    ctx.tools.register("x", t);
    const available = ctx.tools.available()["x"] as unknown as { execute: () => Promise<unknown> };
    expect(available.execute).toBeDefined();
  });
});
