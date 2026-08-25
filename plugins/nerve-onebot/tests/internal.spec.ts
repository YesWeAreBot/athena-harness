import type { Dict } from "cosmokit";
import { describe, expect, it } from "vitest";

import { Internal } from "../src/types.js";

describe("Internal API", () => {
  it("generates *Async variants for set/send/delete methods", () => {
    const internal = new Internal("12345");
    expect(internal.sendGroupMsgAsync).toBeTypeOf("function");
    expect(internal.setGroupKickAsync).toBeTypeOf("function");
    expect(internal.deleteMsgAsync).toBeTypeOf("function");
    expect(internal.uploadGroupFileAsync).toBeTypeOf("function");
    expect(internal.setGroupAnonymousBanAsync).toBeTypeOf("function");
  });

  it("does not generate *Async for get methods", () => {
    const internal = new Internal("12345");
    // SAFETY: the dynamic methods are not part of the typed interface; a Dict
    // view lets us assert their absence.
    const view = internal as Dict;
    expect(view.getLoginInfoAsync).toBeUndefined();
    expect(view.getGroupListAsync).toBeUndefined();
  });

  it("setGroupAnonymousBan sends flag for string meta", async () => {
    const internal = new Internal("12345");
    let captured: { action: string; params: Dict } | undefined;
    internal._request = async (action, params) => {
      captured = { action, params };
      return { status: "ok", retcode: 0, data: null };
    };

    await internal.setGroupAnonymousBan("67890", "flag_abc", 60);
    expect(captured!.action).toBe("set_group_anonymous_ban");
    expect(captured!.params.flag).toBe("flag_abc");
    expect(captured!.params.anonymous).toBeUndefined();
    expect(captured!.params.duration).toBe(60);
  });

  it("setGroupAnonymousBan sends anonymous object for object meta", async () => {
    const internal = new Internal("12345");
    let captured: { action: string; params: Dict } | undefined;
    internal._request = async (action, params) => {
      captured = { action, params };
      return { status: "ok", retcode: 0, data: null };
    };

    const anon = { id: 1, name: "anon", flag: "f" };
    await internal.setGroupAnonymousBan("67890", anon, 120);
    expect(captured!.action).toBe("set_group_anonymous_ban");
    expect(captured!.params.anonymous).toEqual(anon);
    expect(captured!.params.flag).toBeUndefined();
  });

  it("async variant calls the _async endpoint", async () => {
    const internal = new Internal("12345");
    let captured: { action: string; params: Dict } | undefined;
    internal._request = async (action, params) => {
      captured = { action, params };
      return { status: "ok", retcode: 0, data: null };
    };

    await internal.sendGroupMsgAsync("67890", [{ type: "text", data: { text: "hi" } }]);
    expect(captured!.action).toBe("send_group_msg_async");
    expect(captured!.params.message).toEqual([{ type: "text", data: { text: "hi" } }]);
  });
});
