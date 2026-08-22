import type { JsonObject, MessageSink, SandboxHubService, SandboxNerveHandle } from "@athena-ai/protocol";
import { Satori, type Session } from "@satorijs/core";
import { Context } from "cordis";
import type { Dict } from "cosmokit";
import { describe, expect, it } from "vitest";

import SandboxHub from "../../sandbox/src/index";
import SandboxNerve from "../src/index";

const PLATFORM = "sandbox:nerve-test";

interface Frame {
  type: string;
  body?: JsonObject;
}

/** Stands in for a browser tab holding a WebUI socket. */
class FakeClient {
  readonly id = Math.random().toString(36).slice(2);
  readonly frames: Frame[] = [];

  send(payload: { type: string; body: unknown }) {
    // SAFETY: Test frames emitted by the sandbox transport always carry JSON object bodies.
    this.frames.push(payload as Frame);
  }

  last(type: string): Frame | undefined {
    return this.frames.filter((frame) => frame.type === type).at(-1);
  }
}

/** Minimal WebUI mock. */
class FakeWebUI {
  readonly listeners: Dict<(body?: JsonObject) => void> = Object.create(null);
  readonly clients: Dict<FakeClient> = Object.create(null);
  addEntry() {
    return {};
  }
}

/** Minimal Life mock. */
class FakeLife {
  persona = { name: "Alice", description: "A test persona", traits: {} };
  memory = { store: async () => {}, retrieve: async () => null, search: async () => [] };
  bind() {
    return () => {};
  }
}

interface HubInternals extends SandboxHubService {
  _nerves: Map<string, SandboxNerveHandle>;
}

function hubInternals(hub: SandboxHub): HubInternals {
  // SAFETY: SandboxHub keeps its per-Life registry in `_nerves`; these tests read it to drive a nerve directly.
  return hub as HubInternals;
}

function sinkFor(client: FakeClient): MessageSink {
  return { send: (frame) => client.send(frame) };
}

async function setup() {
  const ctx = new Context();

  // Provide webui on root
  const webui = new FakeWebUI();
  ctx.provide("webui");
  ctx.set("webui", webui);

  // Install sandbox Hub on root (only needs webui)
  await ctx.plugin(SandboxHub, { fileServer: { enabled: false } });

  // Create an isolated group for the Life (mimics persona group)
  const group = ctx.isolate("satori").isolate("bots").isolate("life");
  await group.plugin(Satori);

  // Provide life on the group
  const life = new FakeLife();
  group.provide("life");
  group.set("life", life);

  // Install nerve on the group
  await group.plugin(SandboxNerve);

  const client = new FakeClient();
  webui.clients[client.id] = client;

  const sessions: Session[] = [];
  group.on("message", (session) => void sessions.push(session));
  group.on("message-deleted", (session) => void sessions.push(session));

  return { ctx, group, webui, client, sessions, life };
}

function getHub(ctx: Context): SandboxHub {
  const hub = ctx.get("sandbox");
  if (!(hub instanceof SandboxHub)) throw new Error("sandbox service is not a SandboxHub");
  return hub;
}

describe("sandbox-nerve", () => {
  it("registers with the Hub using life persona name", async () => {
    const { ctx } = await setup();
    const hub = getHub(ctx);
    const lives = hub.lives();
    expect(lives).toHaveLength(1);
    expect(lives[0].id).toBe("alice");
    expect(lives[0].meta.name).toBe("Alice");
    expect(lives[0].meta.description).toBe("A test persona");
  });

  it("dispatches message through nerve to local satori", async () => {
    const { ctx, client, sessions } = await setup();
    const hub = getHub(ctx);
    const nerveHandle = hubInternals(hub)._nerves.get("alice")!;
    expect(nerveHandle).toBeDefined();

    const sink = sinkFor(client);
    await nerveHandle.dispatch({
      clientId: client.id,
      platform: PLATFORM,
      user: "Bob",
      channel: "@Bob",
      content: "hello from nerve test",
      sink,
    });

    // Should echo message back via sink
    const echo = client.last("sandbox/message");
    expect(echo?.body).toMatchObject({
      content: "hello from nerve test",
      user: "Bob",
      channel: "@Bob",
      platform: PLATFORM,
      lifeId: "alice",
    });

    // Should dispatch session in local satori
    expect(sessions).toHaveLength(1);
    expect(sessions[0].type).toBe("message-created");
    expect(sessions[0].content).toBe("hello from nerve test");
    expect(sessions[0].userId).toBe("Bob");
  });

  it("handles delete-message dispatch", async () => {
    const { ctx, client, sessions } = await setup();
    const hub = getHub(ctx);
    const nerveHandle = hubInternals(hub)._nerves.get("alice")!;
    const sink = sinkFor(client);

    // First create a bot by sending a normal message
    await nerveHandle.dispatch({
      clientId: client.id,
      platform: PLATFORM,
      user: "Bob",
      channel: "@Bob",
      content: "setup",
      sink,
    });

    // Now delete
    await nerveHandle.dispatch({
      clientId: client.id,
      platform: PLATFORM,
      user: "Bob",
      channel: "@Bob",
      content: "__delete:msg123",
      sink,
    });

    expect(sessions).toHaveLength(2);
    expect(sessions[1].type).toBe("message-deleted");
    expect(sessions[1].messageId).toBe("msg123");
  });

  it("unregisters from Hub when nerve is disposed", async () => {
    const { ctx, group } = await setup();
    const hub = getHub(ctx);
    expect(hub.lives()).toHaveLength(1);

    await group.fiber.dispose();
    expect(hub.lives()).toHaveLength(0);
  });

  it("uses persona name as bot selfName", async () => {
    const { ctx, group, client } = await setup();
    const hub = getHub(ctx);
    const nerveHandle = hubInternals(hub)._nerves.get("alice")!;
    const sink = sinkFor(client);

    await nerveHandle.dispatch({
      clientId: client.id,
      platform: PLATFORM,
      user: "Bob",
      channel: "@Bob",
      content: "hi",
      sink,
    });

    // The bot should use the Life's persona name
    const satori = group.get("satori")!;
    const bot = satori.bots[0];
    expect(bot.user!.name).toBe("Alice");
  });

  it("bot replies reach the sink", async () => {
    const { ctx, group, client } = await setup();
    const hub = getHub(ctx);
    const nerveHandle = hubInternals(hub)._nerves.get("alice")!;
    const sink = sinkFor(client);

    await nerveHandle.dispatch({
      clientId: client.id,
      platform: PLATFORM,
      user: "Bob",
      channel: "@Bob",
      content: "hello",
      sink,
    });

    // Now send a reply from the bot
    const satori = group.get("satori")!;
    const bot = satori.bots[0];
    await bot.sendMessage("@Bob", "reply from Alice");

    // The reply should be sent through the sink
    const replies = client.frames.filter((f) => f.type === "sandbox/message" && f.body?.user === "Alice");
    expect(replies).toHaveLength(1);
    expect(replies[0].body?.content).toBe("reply from Alice");
  });
});
