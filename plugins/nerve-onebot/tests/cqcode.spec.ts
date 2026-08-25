import { describe, expect, it } from "vitest";

import { CQCode } from "../src/bot/cqcode.js";

describe("CQCode", () => {
  it("escapes special characters", () => {
    expect(CQCode.escape("a&b")).toBe("a&amp;b");
    expect(CQCode.escape("[x]")).toBe("&#91;x&#93;");
    expect(CQCode.escape("a,b", true)).toBe("a&#44;b");
    expect(CQCode.escape("a,b", false)).toBe("a,b");
  });

  it("unescapes special characters", () => {
    expect(CQCode.unescape("a&amp;b")).toBe("a&b");
    expect(CQCode.unescape("&#91;x&#93;")).toBe("[x]");
    expect(CQCode.unescape("&#44;")).toBe(",");
  });

  it("round-trips encode and parse", () => {
    const source = "[CQ:image,file=abc.png,url=http://x/y.png]";
    const elements = CQCode.parse(source);
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("image");
    expect(elements[0].attrs.file).toBe("abc.png");
    expect(elements[0].attrs.url).toBe("http://x/y.png");

    // SAFETY: element attrs are string-keyed dictionaries; CQCode.encode expects Record<string, string>.
    const encoded = CQCode.encode("image", elements[0].attrs as Record<string, string>);
    expect(CQCode.parse(encoded)).toEqual(elements);
  });

  it("parses text around CQ codes", () => {
    const elements = CQCode.parse("hello [CQ:face,id=1] world");
    expect(elements).toHaveLength(3);
    expect(elements[0]).toMatchObject({ type: "text", attrs: { content: "hello " } });
    expect(elements[1]).toMatchObject({ type: "face", attrs: { id: "1" } });
    expect(elements[2]).toMatchObject({ type: "text", attrs: { content: " world" } });
  });

  it("parses array input", () => {
    const elements = CQCode.parse([
      { type: "text", data: { text: "hi" } },
      { type: "at", data: { qq: "123" } },
    ]);
    expect(elements).toHaveLength(2);
    expect(elements[0]).toMatchObject({ type: "text", attrs: { content: "hi" } });
    expect(elements[1]).toMatchObject({ type: "at", attrs: { qq: "123" } });
  });

  it("handles escaped commas in attribute values", () => {
    const elements = CQCode.parse("[CQ:share,url=http://x/y?a=1&#44;b=2]");
    expect(elements[0].attrs.url).toBe("http://x/y?a=1,b=2");
  });
});
