import { NerveService } from "@athena-ai/protocol";
import Http from "@cordisjs/plugin-http";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { OneBotBody } from "../src/body.js";

const testConfig: OneBotBody.Config = {
  protocol: "ws",
  selfId: "12345",
  endpoint: "ws://localhost:6700",
  responseTimeout: 15000,
  retryTimes: 1,
  retryInterval: 10,
  retryLazy: 10,
};

class LifecycleBody extends OneBotBody {
  public connected = 0;
  public disconnected = 0;

  async connect(): Promise<void> {
    this.connected++;
    this.online();
  }

  async disconnect(): Promise<void> {
    this.disconnected++;
    this.offline();
  }
}

describe("OneBotBody lifecycle", () => {
  it("auto-connects when installed as a plugin", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    await ctx.plugin(Http);
    await ctx.plugin(LifecycleBody, testConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // SAFETY: the body registered under this sid is the LifecycleBody instance we installed.
    const body = ctx.nerve.get("onebot:12345") as LifecycleBody;
    expect(body).toBeDefined();
    expect(body.connected).toBe(1);
    expect(body.status).toBe("online");
  });

  it("auto-disconnects when the plugin is unloaded", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    await ctx.plugin(Http);
    await ctx.plugin(LifecycleBody, testConfig);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // SAFETY: the body registered under this sid is the LifecycleBody instance we installed.
    const body = ctx.nerve.get("onebot:12345") as LifecycleBody;
    expect(body.connected).toBe(1);

    ctx.registry.delete(LifecycleBody);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(body.disconnected).toBe(1);
    expect(body.status).toBe("offline");
  });

  it("registers itself into NerveService", async () => {
    const ctx = new Context();
    await ctx.plugin(NerveService);
    await ctx.plugin(Http);
    await ctx.plugin(LifecycleBody, testConfig);

    expect(ctx.nerve.get("onebot:12345")).toBeInstanceOf(LifecycleBody);
  });
});
