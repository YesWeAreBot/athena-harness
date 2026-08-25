import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { Body, NerveService, Session } from "../src/nerve.js";

declare module "cordis" {
  interface Events {
    "test-event"(session: Session): void;
  }
}

class MockBody extends Body<{ selfId: string }> {
  platform = "mock";

  constructor(ctx: Context, config: { selfId: string }) {
    super(ctx, config);
    this.selfId = config.selfId;
  }

  async connect() {
    this.online();
  }

  async disconnect() {
    this.offline();
  }
}

describe("NerveService", () => {
  it("registers and tracks bodies", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    ctx.nerve.register(body);
    expect(ctx.nerve.bodies).toHaveLength(1);
    expect(ctx.nerve.bodies[0]).toBe(body);
    expect(body.sid).toBe("mock:bot_1");
  });

  it("unregisters body on dispose", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    const dispose = ctx.nerve.register(body);
    expect(ctx.nerve.bodies).toHaveLength(1);
    dispose();
    expect(ctx.nerve.bodies).toHaveLength(0);
  });
});

describe("Body", () => {
  it("dispatches a Session to the cordis event bus via internal/session", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    ctx.nerve.register(body);

    const received: Session[] = [];
    ctx.on("test-event", (session) => {
      received.push(session);
    });

    const session = body.session({ type: "test-event", id: "evt_1" });
    body.dispatch(session);

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("test-event");
    expect(received[0].body).toBe(body);
  });

  it("normalizes through internal/session exactly once", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    ctx.nerve.register(body);

    let concrete = 0;
    let internal = 0;
    ctx.on("internal/session", () => {
      internal++;
    });
    ctx.on("test-event", () => {
      concrete++;
    });

    body.dispatch(body.session({ type: "test-event" }));
    expect(internal).toBe(1);
    expect(concrete).toBe(1);
  });

  it("has correct sid format", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "12345" });
    expect(body.sid).toBe("mock:12345");
  });

  it("tracks status transitions", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    expect(body.status).toBe("offline");
    expect(body.isActive).toBe(false);

    body.online();
    expect(body.status).toBe("online");
    expect(body.isActive).toBe(true);

    const error = new Error("disconnected");
    body.offline(error);
    expect(body.status).toBe("offline");
    expect(body.error).toBe(error);
    expect(body.isActive).toBe(false);
  });
});
