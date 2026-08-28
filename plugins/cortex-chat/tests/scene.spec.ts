import { describe, expect, it } from "vitest";

import { decodeSceneAddress, encodeSceneAddress, parseInitialFocus, sameScene } from "../src/scene.js";

describe("SceneAddress", () => {
  it("uses bodySid and channelId as the Scene identity", () => {
    const address = { bodySid: "onebot:100", channelId: "42" };
    expect(encodeSceneAddress(address)).not.toBe("onebot:42");
    expect(decodeSceneAddress(encodeSceneAddress(address))).toEqual(address);
  });

  it("distinguishes two bodies with the same channel id", () => {
    const a = encodeSceneAddress({ bodySid: "onebot:100", channelId: "42" });
    const b = encodeSceneAddress({ bodySid: "onebot:200", channelId: "42" });
    expect(a).not.toBe(b);
  });

  it("rejects malformed Scene keys instead of guessing", () => {
    expect(() => decodeSceneAddress("onebot:42:extra")).toThrow(/Scene/);
  });

  it("encodes as encodeURIComponent(bodySid)/encodeURIComponent(channelId)", () => {
    const address = { bodySid: "onebot:100", channelId: "42" };
    expect(encodeSceneAddress(address)).toBe(`${encodeURIComponent("onebot:100")}/${encodeURIComponent("42")}`);
  });

  it("round-trips colons inside fields", () => {
    const address = { bodySid: "satori:onebot:100", channelId: "guild:42:extra" };
    expect(decodeSceneAddress(encodeSceneAddress(address))).toEqual(address);
  });

  it("round-trips slash and special characters", () => {
    const address = { bodySid: "a/b c", channelId: "x/y:z" };
    const encoded = encodeSceneAddress(address);
    expect(encoded).toBe(`${encodeURIComponent("a/b c")}/${encodeURIComponent("x/y:z")}`);
    expect(decodeSceneAddress(encoded)).toEqual(address);
  });

  it("rejects empty bodySid or channelId on encode", () => {
    expect(() => encodeSceneAddress({ bodySid: "", channelId: "42" })).toThrow(/Scene/);
    expect(() => encodeSceneAddress({ bodySid: "onebot:100", channelId: "" })).toThrow(/Scene/);
  });

  it("rejects missing slash on decode", () => {
    expect(() => decodeSceneAddress("onebot:100")).toThrow(/Scene/);
  });

  it("rejects extra slash on decode", () => {
    expect(() => decodeSceneAddress("a/b/c")).toThrow(/Scene/);
  });

  it("rejects empty component after decode", () => {
    const emptyBody = `${encodeURIComponent("")}/${encodeURIComponent("42")}`;
    expect(() => decodeSceneAddress(emptyBody)).toThrow(/Scene/);
    const emptyChannel = `${encodeURIComponent("onebot:100")}/${encodeURIComponent("")}`;
    expect(() => decodeSceneAddress(emptyChannel)).toThrow(/Scene/);
  });

  it("error message contains the invalid value", () => {
    const bad = "onebot:42:extra";
    expect(() => decodeSceneAddress(bad)).toThrow(bad);
  });

  it("sameScene returns true for equal addresses", () => {
    const a = { bodySid: "onebot:100", channelId: "42" };
    const b = { bodySid: "onebot:100", channelId: "42" };
    expect(sameScene(a, b)).toBe(true);
  });

  it("sameScene returns false for different bodySid or channelId", () => {
    const a = { bodySid: "onebot:100", channelId: "42" };
    const b = { bodySid: "onebot:200", channelId: "42" };
    const c = { bodySid: "onebot:100", channelId: "99" };
    expect(sameScene(a, b)).toBe(false);
    expect(sameScene(a, c)).toBe(false);
  });

  it("sameScene handles null", () => {
    const a = { bodySid: "onebot:100", channelId: "42" };
    expect(sameScene(null, null)).toBe(true);
    expect(sameScene(a, null)).toBe(false);
    expect(sameScene(null, a)).toBe(false);
  });

  describe("parseInitialFocus", () => {
    it("returns null for empty string", () => {
      expect(parseInitialFocus("")).toBeNull();
    });

    it("parses a valid encoded SceneAddress", () => {
      const address = { bodySid: "onebot:100", channelId: "42" };
      const encoded = encodeSceneAddress(address);
      expect(parseInitialFocus(encoded)).toEqual(address);
    });

    it("throws with supplied value for malformed input", () => {
      const bad = "not-a-scene";
      expect(() => parseInitialFocus(bad)).toThrow(bad);
      expect(() => parseInitialFocus(bad)).toThrow(/Scene|initialFocus|config/i);
    });

    it("throws with supplied value for extra component", () => {
      const bad = "onebot:42:extra";
      expect(() => parseInitialFocus(bad)).toThrow(bad);
    });
  });
});
