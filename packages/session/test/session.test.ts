import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { InvalidReplaceRangeError, Session, ToolCallMissingError, TurnClosedError, TurnNotOpenError, restoreSession, sessionRegistry } from "../src/index.js";

// ── Invariant: TurnNotOpenError ────────────────────────────────────────────
describe("Session write-time invariants", () => {
  it("throws TurnNotOpenError when step event references a turn that has no turn/start", () => {
    const s = new Session();
    expect(() => s.append("step/start", { turn: 1, step: 1 })).toThrowError(TurnNotOpenError);
  });

  it("throws ToolCallMissingError when tool/result has no matching tool/call", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    expect(() =>
      s.append("tool/result", {
        turn: 1,
        step: 1,
        result: { type: "tool-result", toolCallId: "abc", toolName: "t", output: { type: "text", value: "x" } },
        status: "ok",
      }),
    ).toThrowError(ToolCallMissingError);
  });

  it("throws TurnClosedError when appending to a turn after turn/end", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    s.append("turn/end", { turn: 1, reason: { kind: "completed" } });
    expect(() => s.append("step/start", { turn: 1, step: 1 })).toThrowError(TurnClosedError);
  });

  it("throws InvalidReplaceRangeError when replace range is out of bounds", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    // surface is empty — any replace should throw
    expect(() =>
      s.append(
        "turn/end",
        { turn: 1, reason: { kind: "completed" } },
        {
          surfaceOp: { replace: { start: 0, end: 5 } },
        },
      ),
    ).toThrowError(InvalidReplaceRangeError);
  });
});

// ── Surface append + replace ───────────────────────────────────────────────
describe("Surface", () => {
  it("append-mode grows nodes list", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    s.append("step/start", { turn: 1, step: 1 }, { surfaceOp: "append" });
    expect(s.surface.nodes).toHaveLength(1);
    expect(s.surface.nodes[0]!.seq).toBe(2);
  });

  it("replace-mode collapses multiple nodes into one", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    s.append("step/start", { turn: 1, step: 1 }, { surfaceOp: "append" }); // seq=2, node[0]
    s.append("step/end", { turn: 1, step: 1 }, { surfaceOp: "append" }); // seq=3, node[1]
    // Replace both surface nodes with one synthetic node
    s.append(
      "turn/end",
      { turn: 1, reason: { kind: "completed" } },
      {
        surfaceOp: { replace: { start: 0, end: 2 } },
      },
    );
    expect(s.surface.nodes).toHaveLength(1);
    expect(s.surface.nodes[0]!.seq).toBe(4);
  });
});

// ── Append ordering ────────────────────────────────────────────────────────
describe("Session.append ordering", () => {
  it("assigns strictly increasing seq values", () => {
    const s = new Session();
    const e1 = s.append("turn/start", { turn: 1 });
    const e2 = s.append("step/start", { turn: 1, step: 1 });
    expect(e1.seq).toBe(1);
    expect(e2.seq).toBe(2);
  });

  it("getEvent(seq) returns the correct event", () => {
    const s = new Session();
    const ev = s.append("turn/start", { turn: 1 });
    expect(s.getEvent(1)).toBe(ev);
    expect(s.getEvent(99)).toBeUndefined();
  });
});

// ── snapshot + restore roundtrip ───────────────────────────────────────────
describe("snapshot / restore", () => {
  it("restore produces identical events", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    s.append("step/start", { turn: 1, step: 1 }, { surfaceOp: "append" });
    s.append("turn/end", { turn: 1, reason: { kind: "completed" } });
    const snap = s.snapshot();
    const r = restoreSession(snap.header, snap.events);
    expect(r.events).toEqual(s.events);
  });

  it("restore reproduces surface nodes", () => {
    const s = new Session();
    s.append("turn/start", { turn: 1 });
    s.append("step/start", { turn: 1, step: 1 }, { surfaceOp: "append" });
    const snap = s.snapshot();
    const r = restoreSession(snap.header, snap.events);
    expect(r.surface.nodes).toEqual(s.surface.nodes);
  });
});

// ── SessionRegistry ────────────────────────────────────────────────────────
describe("SessionRegistry", () => {
  it("create + get + remove", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionRegistry);
    const session = ctx.sessions.create({ id: "s1" });
    expect(ctx.sessions.get("s1")).toBe(session);
    ctx.sessions.remove("s1");
    expect(ctx.sessions.get("s1")).toBeUndefined();
  });

  it("duplicate create throws", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionRegistry);
    ctx.sessions.create({ id: "dup" });
    expect(() => ctx.sessions.create({ id: "dup" })).toThrow(/already exists/);
  });

  it("setPersistence duplicate throws", async () => {
    const ctx = new Context();
    await ctx.plugin(sessionRegistry);
    const handler = {
      prepare: async () => {
        throw new Error();
      },
      create: async () => {
        throw new Error();
      },
      open: async () => {
        throw new Error();
      },
    };
    ctx.sessions.setPersistence(handler);
    expect(() => ctx.sessions.setPersistence(handler)).toThrow(/already registered/);
  });
});
