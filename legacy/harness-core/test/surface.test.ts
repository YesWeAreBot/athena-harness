import { describe, expect, it } from "vitest";

import { Session } from "../src/session/index.js";

describe("session surface", () => {
  it("appends model-visible events and replaces a contiguous range", () => {
    const session = new Session({ id: "surface-1" });
    const first = session.append("user/message", { content: "first" }, { surfaceOp: "append" });
    const second = session.append("user/message", { content: "second" }, { surfaceOp: "append" });
    const replacementSeq = session.length + 1;

    const replacement = session.append(
      "user/message",
      { content: "replacement" },
      {
        surfaceOp: { op: "replace", start: 0, end: 1 },
        sourceEventSeqs: [first.seq, second.seq, replacementSeq],
      },
    );

    expect(session.surface.snapshot.generation).toBe(1);
    expect(session.surface.snapshot.nodes).toHaveLength(1);
    expect(replacement.seq).toBe(replacementSeq);
    expect(session.surface.snapshot.nodes[0]?.sourceEventSeqs).toEqual([1, 2, 3]);
  });

  it("rejects replacements that do not cite every shadowed source event", () => {
    const session = new Session({ id: "surface-2" });
    const first = session.append("user/message", { content: "first" }, { surfaceOp: "append" });
    session.append("user/message", { content: "second" }, { surfaceOp: "append" });
    const replacementSeq = session.length + 1;

    expect(() =>
      session.append(
        "user/message",
        { content: "replacement" },
        {
          surfaceOp: { op: "replace", start: 0, end: 1 },
          sourceEventSeqs: [first.seq, replacementSeq],
        },
      ),
    ).toThrow(/cite every shadowed source event/);
  });

  it("rejects surface ops on lifecycle events", () => {
    const session = new Session({ id: "surface-3" });

    expect(() => session.append("turn/start", { turn: 1 }, { surfaceOp: "append" })).toThrow(/forbidden/);
  });

  it("requires a surface op for model-visible events", () => {
    const session = new Session({ id: "surface-4" });

    expect(() => session.append("user/message", { content: "missing" })).toThrow(/requires a Surface op/);
  });

  it("deep-freezes event data and surface snapshots", () => {
    const session = new Session({ id: "surface-5" });
    session.append(
      "user/message",
      {
        content: "deep",
        nested: { value: 1 },
      },
      { surfaceOp: "append" },
    );

    const event = session.snapshotEvents[0];
    const data = event?.data as { nested: object };
    expect(Object.isFrozen(data.nested)).toBe(true);

    const snapshot = session.surface.snapshot;
    expect(Object.isFrozen(snapshot.nodes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.nodes[0]?.sourceEventSeqs)).toBe(true);
  });
});
