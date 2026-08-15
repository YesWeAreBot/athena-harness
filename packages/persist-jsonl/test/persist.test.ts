import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SessionRegistry, type SessionEvent, type SessionHeader } from "@athena/session";
import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { PersistJsonl } from "../src/index.js";

async function makeDir() {
  return mkdtemp(join(tmpdir(), "athena-persist-"));
}

describe("JsonlHandler", () => {
  it("create → append → flush → prepare roundtrip", async () => {
    const dir = await makeDir();
    try {
      const ctx = new Context();
      await ctx.plugin(SessionRegistry);
      await ctx.plugin(PersistJsonl({ dir }));

      const header: SessionHeader = { id: "session-1", createdAt: Date.now() };
      const binding = await ctx.sessions.persistence!.create(header);

      const event: SessionEvent = {
        type: "turn/start",
        seq: 1,
        time: Date.now(),
        data: { turn: 1 },
      };
      binding.append([event]);
      await binding.flush();
      await binding.close();

      const prepared = await ctx.sessions.persistence!.prepare("session-1");
      expect(prepared.header.id).toBe("session-1");
      expect(prepared.events).toHaveLength(1);
      expect(prepared.events[0]!.type).toBe("turn/start");
      await prepared.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("open() appends without truncating existing events", async () => {
    const dir = await makeDir();
    try {
      const ctx = new Context();
      await ctx.plugin(SessionRegistry);
      await ctx.plugin(PersistJsonl({ dir }));

      const header: SessionHeader = { id: "session-2", createdAt: Date.now() };
      const b1 = await ctx.sessions.persistence!.create(header);
      b1.append([{ type: "turn/start", seq: 1, time: 1, data: { turn: 1 } }]);
      await b1.flush();
      await b1.close();

      const b2 = await ctx.sessions.persistence!.open("session-2");
      b2.append([{ type: "step/start", seq: 2, time: 2, data: { turn: 1, step: 1 } }]);
      await b2.flush();
      await b2.close();

      const prepared = await ctx.sessions.persistence!.prepare("session-2");
      expect(prepared.events).toHaveLength(2);
      expect(prepared.events[0]!.type).toBe("turn/start");
      expect(prepared.events[1]!.type).toBe("step/start");
      await prepared.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("multiple append calls before a single flush are all persisted", async () => {
    const dir = await makeDir();
    try {
      const ctx = new Context();
      await ctx.plugin(SessionRegistry);
      await ctx.plugin(PersistJsonl({ dir }));

      const header: SessionHeader = { id: "session-3", createdAt: Date.now() };
      const binding = await ctx.sessions.persistence!.create(header);

      binding.append([{ type: "turn/start", seq: 1, time: 1, data: { turn: 1 } }]);
      binding.append([{ type: "step/start", seq: 2, time: 2, data: { turn: 1, step: 1 } }]);
      binding.append([{ type: "step/end", seq: 3, time: 3, data: { turn: 1, step: 1 } }]);
      // One flush — all three events must land
      await binding.flush();
      await binding.close();

      const prepared = await ctx.sessions.persistence!.prepare("session-3");
      expect(prepared.events).toHaveLength(3);
      await prepared.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("create() on existing id throws (EEXIST)", async () => {
    const dir = await makeDir();
    try {
      const ctx = new Context();
      await ctx.plugin(SessionRegistry);
      await ctx.plugin(PersistJsonl({ dir }));

      const header: SessionHeader = { id: "session-dup", createdAt: Date.now() };
      const b = await ctx.sessions.persistence!.create(header);
      await b.close();
      await expect(ctx.sessions.persistence!.create(header)).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("prepare() on a malformed file throws with 'malformed JSON'", async () => {
    const dir = await makeDir();
    try {
      const ctx = new Context();
      await ctx.plugin(SessionRegistry);
      await ctx.plugin(PersistJsonl({ dir }));

      await writeFile(join(dir, `${encodeURIComponent("broken")}.jsonl`), "not json\n");
      await expect(ctx.sessions.persistence!.prepare("broken")).rejects.toThrow(/malformed JSON/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
