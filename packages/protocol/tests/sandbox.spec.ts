import { describe, expect, it } from "vitest";

import type { MessageSink, SandboxDispatchPayload, SandboxHubService, SandboxNerveHandle } from "../src/sandbox";

describe("sandbox protocol types", () => {
  it("MessageSink is structurally valid", () => {
    const frames: Array<{ type: string; body: unknown }> = [];
    const sink: MessageSink = {
      send(frame) {
        frames.push(frame);
      },
    };
    sink.send({ type: "sandbox/message", body: { id: "1" } });
    expect(frames).toHaveLength(1);
    expect(frames[0].type).toBe("sandbox/message");
  });

  it("SandboxNerveHandle is structurally valid", () => {
    const dispatched: SandboxDispatchPayload[] = [];
    const released: string[] = [];
    const handle: SandboxNerveHandle = {
      meta: { name: "Alice", description: "Test persona" },
      async dispatch(payload) {
        dispatched.push(payload);
      },
      async request(_method, _data) {
        return { ok: true };
      },
      async release({ platform }) {
        released.push(platform);
      },
    };
    expect(handle.meta.name).toBe("Alice");
    expect(handle.meta.description).toBe("Test persona");
  });

  it("SandboxNerveHandle.meta.description is optional", () => {
    const handle: SandboxNerveHandle = {
      meta: { name: "Bob" },
      async dispatch() {},
      async request() {
        return null;
      },
      async release() {},
    };
    expect(handle.meta.description).toBeUndefined();
  });

  it("SandboxHubService register returns a disposer", () => {
    let registered = false;
    const hub: SandboxHubService = {
      register(_id, _nerve) {
        registered = true;
        return () => {
          registered = false;
        };
      },
      lives() {
        return [];
      },
      fileBase: undefined,
    };

    const nerve: SandboxNerveHandle = {
      meta: { name: "Test" },
      async dispatch() {},
      async request() {
        return null;
      },
      async release() {},
    };

    const dispose = hub.register("test", nerve);
    expect(registered).toBe(true);
    dispose();
    expect(registered).toBe(false);
  });

  it("SandboxHubService.lives returns id and meta", () => {
    const nerve: SandboxNerveHandle = {
      meta: { name: "Alice", description: "Friendly" },
      async dispatch() {},
      async request() {
        return null;
      },
      async release() {},
    };

    const registry = new Map<string, SandboxNerveHandle>();
    registry.set("alice", nerve);

    const hub: SandboxHubService = {
      register(id, n) {
        registry.set(id, n);
        return () => registry.delete(id);
      },
      lives() {
        return [...registry.entries()].map(([id, n]) => ({ id, meta: n.meta }));
      },
      fileBase: "http://localhost:5140/sandbox/file",
    };

    const result = hub.lives();
    expect(result).toEqual([{ id: "alice", meta: { name: "Alice", description: "Friendly" } }]);
    expect(hub.fileBase).toBe("http://localhost:5140/sandbox/file");
  });

  it("SandboxDispatchPayload carries sink and optional quote", () => {
    const frames: unknown[] = [];
    const payload: SandboxDispatchPayload = {
      clientId: "c1",
      platform: "sandbox:abc",
      user: "user1",
      channel: "general",
      content: "Hello",
      quote: { id: "q1", content: "prev", user: "user0" },
      sink: { send: (f) => frames.push(f) },
    };

    payload.sink.send({ type: "sandbox/message", body: { text: "hi" } });
    expect(frames).toHaveLength(1);
    expect(payload.quote!.id).toBe("q1");
  });

  it("SandboxDispatchPayload.quote is optional", () => {
    const payload: SandboxDispatchPayload = {
      clientId: "c2",
      platform: "sandbox:xyz",
      user: "user2",
      channel: "dm",
      content: "Hey",
      sink: { send() {} },
    };
    expect(payload.quote).toBeUndefined();
  });
});
