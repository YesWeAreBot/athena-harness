import { describe, expect, it } from "vitest";

import { Inbox } from "../src/inbox.js";

describe("Inbox slot semantics", () => {
  it("pushTurn content appears in claimTurn result", () => {
    const inbox = new Inbox();
    inbox.pushTurn("hello");
    const claimed = inbox.claimTurn();
    expect(claimed).toEqual(["hello"]);
  });

  it("pushStep content appears in claimStep result", () => {
    const inbox = new Inbox();
    inbox.pushStep("step input");
    expect(inbox.claimStep()).toEqual(["step input"]);
  });

  it("claimTurn does not drain next-step slot", () => {
    const inbox = new Inbox();
    inbox.pushTurn("turn");
    inbox.pushStep("step");
    inbox.claimTurn();
    expect(inbox.claimStep()).toEqual(["step"]);
  });

  it("claimStep does not drain next-turn slot", () => {
    const inbox = new Inbox();
    inbox.pushTurn("turn");
    inbox.pushStep("step");
    inbox.claimStep();
    expect(inbox.claimTurn()).toEqual(["turn"]);
  });

  it("claim is atomic — second claim returns empty", () => {
    const inbox = new Inbox();
    inbox.pushTurn("x");
    inbox.claimTurn();
    expect(inbox.claimTurn()).toEqual([]);
  });

  it("multiple pushes are all returned by claim", () => {
    const inbox = new Inbox();
    inbox.pushTurn("a");
    inbox.pushTurn("b");
    inbox.pushStep("c");
    expect(inbox.claimTurn()).toEqual(["a", "b"]);
    expect(inbox.claimStep()).toEqual(["c"]);
  });

  it("hasTurn and hasStep reflect slot state", () => {
    const inbox = new Inbox();
    expect(inbox.hasTurn).toBe(false);
    expect(inbox.hasStep).toBe(false);
    inbox.pushTurn("t");
    inbox.pushStep("s");
    expect(inbox.hasTurn).toBe(true);
    expect(inbox.hasStep).toBe(true);
    inbox.claimTurn();
    inbox.claimStep();
    expect(inbox.hasTurn).toBe(false);
    expect(inbox.hasStep).toBe(false);
  });
});
