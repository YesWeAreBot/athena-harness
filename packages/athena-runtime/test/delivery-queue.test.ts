import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { DeliveryQueue } from "../src/delivery-queue/index.js";

function innerProvider(events: unknown[]) {
  return {
    id: "inner",
    kinds: ["message"] as const,
    deliver: async (target: unknown) => {
      events.push(target);
      return { id: "inner-delivery", status: "delivered" as const };
    },
  };
}

describe("delivery queue", () => {
  it("persists scheduled deliveries and fires them when due", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-delivery-"));
    try {
      const events: unknown[] = [];
      const queue = new DeliveryQueue({ root, provider: innerProvider(events) });
      const receipt = await queue.schedule({
        kind: "message",
        target: { channel: "a" },
        payload: { text: "hello" },
        at: Date.now() + 30,
      });
      expect(receipt.status).toBe("delayed");

      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(events).toEqual([{ channel: "a" }]);
      await queue.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("cancels pending deliveries", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-delivery-cancel-"));
    try {
      const events: unknown[] = [];
      const queue = new DeliveryQueue({ root, provider: innerProvider(events) });
      const receipt = await queue.schedule({
        kind: "message",
        target: { channel: "b" },
        payload: {},
        at: Date.now() + 50,
      });
      expect(await queue.cancel(receipt.id)).toBe(true);

      await new Promise((resolve) => setTimeout(resolve, 90));
      expect(events).toEqual([]);
      await queue.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("restores pending deliveries after restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "athena-delivery-restore-"));
    try {
      const firstEvents: unknown[] = [];
      const first = new DeliveryQueue({ root, provider: innerProvider(firstEvents) });
      await first.schedule({
        kind: "message",
        target: { channel: "c" },
        payload: {},
        at: Date.now() + 50,
      });
      await first.dispose();

      const secondEvents: unknown[] = [];
      const second = new DeliveryQueue({ root, provider: innerProvider(secondEvents) });
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(secondEvents).toEqual([{ channel: "c" }]);
      await second.dispose();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
