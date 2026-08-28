import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { Context, Service } from "cordis";
import { afterEach, describe, it, expect } from "vitest";

import { Body, LifeService, NerveService } from "../src/index.ts";

class TestLife extends LifeService {
  public id: string;
  public dataDir: string;
  public persona = "test";
  public cortex: Service | null = null;

  constructor(ctx: Context, config: LifeService.Config) {
    super(ctx, "life");
    this.id = config.id;
    this.dataDir = path.resolve(config.dataDir ?? "test-data", encodeURIComponent(config.id));
  }
}

class FakeCortex extends Service {
  constructor(ctx: Context, name: string) {
    super(ctx, name);
  }
}

class TestBody extends Body {
  public platform = "test";

  constructor(ctx: Context, selfId: string) {
    super(ctx, undefined);
    this.selfId = selfId;
  }

  async connect(): Promise<void> {}

  async disconnect(): Promise<void> {}
}

describe("Life", () => {
  let tmpRoot: string | null = null;

  afterEach(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
      tmpRoot = null;
    }
  });

  it("provides ctx.life when installed", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, {
      id: "alice",
    });
    expect(ctx.life).toBeInstanceOf(TestLife);
    expect(ctx.life.id).toBe("alice");
  });

  it("provides a Life-owned NerveService automatically", async () => {
    const root = new Context();
    const life = root.isolate("life", Symbol("alice")).isolate("nerve", Symbol("alice"));
    expect(root.get("nerve")).toBeUndefined();

    await life.plugin(TestLife, { id: "alice" });

    expect(life.nerve).toBeInstanceOf(NerveService);
    expect(root.get("nerve")).toBeUndefined();
  });

  it("keeps same-sid Bodies in separate Life registries and disposes independently", async () => {
    const root = new Context();
    const alice = root.isolate("life", Symbol("alice")).isolate("nerve", Symbol("alice"));
    const bob = root.isolate("life", Symbol("bob")).isolate("nerve", Symbol("bob"));
    const aliceFork = alice.plugin(TestLife, { id: "alice" });
    const bobFork = bob.plugin(TestLife, { id: "bob" });
    await Promise.all([aliceFork, bobFork]);
    const aliceBody = new TestBody(alice, "shared");
    const bobBody = new TestBody(bob, "shared");
    alice.nerve.register(aliceBody);
    bob.nerve.register(bobBody);

    expect(alice.nerve.get("test:shared")).toBe(aliceBody);
    expect(bob.nerve.get("test:shared")).toBe(bobBody);

    await aliceFork.dispose();

    expect(alice.get("nerve")).toBeUndefined();
    expect(bob.nerve.get("test:shared")).toBe(bobBody);
  });

  it("fails when two Lives share one Nerve domain", async () => {
    const root = new Context();
    const alice = root.isolate("life", Symbol("alice")).isolate("cortex", Symbol("alice"));
    const bob = root.isolate("life", Symbol("bob")).isolate("cortex", Symbol("bob"));
    await alice.plugin(TestLife, { id: "alice" });
    let failure: unknown;
    try {
      await bob.plugin(TestLife, { id: "bob" });
    } catch (error) {
      failure = error;
    }
    if (!(failure instanceof Error)) throw new Error("Expected the second Life to fail while sharing a Nerve domain");
    expect(failure.message).toContain('service "nerve" has been registered');
  });

  it("bind stores cortex reference", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, {
      id: "alice",
    });
    const mockCortex = new FakeCortex(ctx, "test-cortex");
    ctx.life.bind(mockCortex);
    expect(ctx.life.cortex).toBeInstanceOf(FakeCortex);
  });

  it("bind throws on second cortex", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, {
      id: "alice",
    });
    const cortex1 = new FakeCortex(ctx, "cortex-1");
    const cortex2 = new FakeCortex(ctx, "cortex-2");
    ctx.life.bind(cortex1);
    expect(() => ctx.life.bind(cortex2)).toThrow("Only one Cortex per Life");
  });

  it("bind returns disposer that clears reference", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, {
      id: "alice",
    });
    const cortex = new FakeCortex(ctx, "test-cortex");
    const unbind = ctx.life.bind(cortex);
    unbind();
    expect(ctx.life.cortex).toBeNull();
  });

  it("disposer ignores if already rebound", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, {
      id: "alice",
    });
    const cortex1 = new FakeCortex(ctx, "cortex-1");
    const cortex2 = new FakeCortex(ctx, "cortex-2");
    const unbind1 = ctx.life.bind(cortex1);
    // Manually clear and rebind (simulating hot-reload)
    unbind1();
    ctx.life.bind(cortex2);
    // Old disposer should not clear new binding
    unbind1();
    expect(ctx.life.cortex).toBeInstanceOf(FakeCortex);
  });

  it("resolves a configured data directory under the Life id", async () => {
    const ctx = new Context();
    await ctx.plugin(TestLife, { id: "alice", dataDir: "/tmp/athena-test" });
    expect(ctx.life.dataDir).toBe(path.resolve("/tmp/athena-test", encodeURIComponent("alice")));
  });

  it("keeps different Life data directories separate", async () => {
    const ctx = new Context();
    const root = await mkdtemp(path.join(tmpdir(), "athena-life-"));
    tmpRoot = root;
    const alice = ctx.isolate("life", Symbol("alice")).isolate("nerve", Symbol("alice"));
    const bob = ctx.isolate("life", Symbol("bob")).isolate("nerve", Symbol("bob"));
    await alice.plugin(TestLife, { id: "alice", dataDir: root });
    await bob.plugin(TestLife, { id: "bob", dataDir: root });
    expect(alice.life.dataDir).not.toBe(bob.life.dataDir);
  });
});
