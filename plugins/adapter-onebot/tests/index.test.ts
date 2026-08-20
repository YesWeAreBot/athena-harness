import { describe, it, expect } from "vitest";

import { CQCode } from "../src/cqcode";
import { OneBotBot } from "../src/index";
import { Internal } from "../src/types";
import { decodeUser, decodeGuildMember } from "../src/utils";

describe("CQCode", () => {
  it("should parse CQ codes from string", () => {
    const elements = CQCode.parse("[CQ:at,qq=123456]hello");
    expect(elements).toHaveLength(2);
    expect(elements[0].type).toBe("at");
    expect(elements[0].attrs).toEqual({ qq: "123456" });
    expect(elements[1].type).toBe("text");
    expect(elements[1].attrs.content).toBe("hello");
  });

  it("should parse text-only messages", () => {
    const elements = CQCode.parse("hello world");
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe("text");
    expect(elements[0].attrs.content).toBe("hello world");
  });

  it("should parse CQCode array input", () => {
    const elements = CQCode.parse([
      { type: "text", data: { text: "hi" } },
      { type: "at", data: { qq: "999" } },
    ]);
    expect(elements).toHaveLength(2);
    expect(elements[0].type).toBe("text");
    expect(elements[0].attrs.content).toBe("hi");
    expect(elements[1].type).toBe("at");
    expect(elements[1].attrs.qq).toBe("999");
  });

  it("should escape and unescape correctly", () => {
    const escaped = CQCode.escape("[test]&comma,");
    expect(escaped).toBe("&#91;test&#93;&amp;comma,");
    expect(CQCode.unescape(escaped)).toBe("[test]&comma,");
  });

  it("should serialize CQCode to string", () => {
    const result = CQCode("image", { file: "http://example.com/a.png" });
    expect(result).toBe("[CQ:image,file=http://example.com/a.png]");
  });

  it("should serialize text type specially", () => {
    const result = CQCode("text", { content: "hello" });
    expect(result).toBe("hello");
  });
});

describe("decodeUser", () => {
  it("should decode account info to User", () => {
    const user = decodeUser({ user_id: 123456, nickname: "TestUser" });
    expect(user.id).toBe("123456");
    expect(user.name).toBe("TestUser");
    expect(user.avatar).toContain("123456");
  });

  it("should prefer tiny_id when available", () => {
    const user = decodeUser({ user_id: 123, nickname: "Test", tiny_id: "tiny_abc" });
    expect(user.id).toBe("tiny_abc");
  });
});

describe("decodeGuildMember", () => {
  it("should decode sender info to GuildMember", () => {
    const member = decodeGuildMember({
      user_id: 789,
      nickname: "Member",
      sex: "male",
      age: 25,
      card: "CardName",
      role: "admin",
    });
    expect(member.user!.id).toBe("789");
    expect(member.nick).toBe("CardName");
    expect(member.roles).toEqual([{ id: "admin" }]);
  });
});

describe("Internal", () => {
  it("should have define and defineExtract static methods", () => {
    expect(typeof Internal.define).toBe("function");
    expect(typeof Internal.defineExtract).toBe("function");
  });

  it("should have generated methods on prototype", () => {
    expect(typeof Internal.prototype.sendPrivateMsg).toBe("function");
    expect(typeof Internal.prototype.sendGroupMsg).toBe("function");
    expect(typeof Internal.prototype.deleteMsg).toBe("function");
    expect(typeof Internal.prototype.getLoginInfo).toBe("function");
    expect(typeof Internal.prototype.getFriendList).toBe("function");
    expect(typeof Internal.prototype.getGroupList).toBe("function");
  });
});

describe("OneBotBot", () => {
  it("should be exported as default and named", () => {
    expect(OneBotBot).toBeDefined();
    expect(OneBotBot.MessageEncoder).toBeDefined();
  });

  it("should have Config schema", () => {
    expect(OneBotBot.Config).toBeDefined();
  });
});
