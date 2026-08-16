import { afterEach, describe, expect, it, vi } from "vitest";

import { OneBotApiClient, OneBotApiError, resolveOneBotConfig } from "../src/index.js";

const config = resolveOneBotConfig({
  wsUrl: "ws://onebot",
  httpUrl: "http://onebot",
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("onebot api client", () => {
  it("posts private messages to send_private_msg", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok", data: { message_id: 1 } }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new OneBotApiClient(config).sendPrivate(100, "hello");

    expect(result.data).toEqual({ message_id: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://onebot/send_private_msg",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ user_id: 100, message: "hello" }),
      }),
    );
  });

  it("sends generic messages with the resolved channel type", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await new OneBotApiClient(config).sendMessage({ groupId: 10, message: "hello" });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://onebot/send_msg",
      expect.objectContaining({
        body: JSON.stringify({ message_type: "group", group_id: 10, message: "hello" }),
      }),
    );
  });

  it("sends access token authorization headers", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const tokenConfig = resolveOneBotConfig({
      wsUrl: "ws://onebot",
      httpUrl: "http://onebot",
      accessToken: "secret",
    });

    await new OneBotApiClient(tokenConfig).recall(99);

    expect(fetchMock).toHaveBeenCalledWith(
      "http://onebot/delete_msg",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret" }),
      }),
    );
  });

  it("retries transient HTTP failures", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response("server error", { status: 500 });
      return new Response(JSON.stringify({ status: "ok", data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await new OneBotApiClient(config).sendGroup(1, "hello", { retries: 1 });

    expect(calls).toBe(2);
  });

  it("does not retry client or API errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: "failed" }), { status: 400 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OneBotApiClient(config).sendLike(1)).rejects.toBeInstanceOf(OneBotApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects non-zero OneBot retcodes", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ retcode: 100, status: "failed" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(new OneBotApiClient(config).sendPrivate(1, "x")).rejects.toThrow(/OneBot API failed/);
  });

  it("honors an aborted caller signal", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();
    controller.abort("stop");

    await expect(new OneBotApiClient(config).sendPrivate(1, "x", { signal: controller.signal })).rejects.toMatchObject({ name: "AbortError", message: "stop" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
