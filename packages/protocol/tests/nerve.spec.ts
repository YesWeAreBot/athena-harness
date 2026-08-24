import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { Body, NerveService } from "../src/nerve.js";

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
  it("dispatches NerveEvent to cordis event bus", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    const body = new MockBody(ctx, { selfId: "bot_1" });
    ctx.nerve.register(body);

    const received: Array<{ type: string; body: Body }> = [];
    ctx.on("test-event", (event) => {
      received.push(event);
    });

    body.dispatch({
      type: "test-event",
      id: "evt_1",
      selfId: "bot_1",
      platform: "mock",
      timestamp: Date.now(),
      body,
    });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("test-event");
    expect(received[0].body).toBe(body);
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
    await body.connect();
    expect(body.status).toBe("online");
    await body.disconnect();
    expect(body.status).toBe("offline");
  });
});
