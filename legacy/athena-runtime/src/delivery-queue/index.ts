import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createId } from "../internal.js";
import type { ModeDeliveryKind, ModeDeliveryProvider, ModeDeliveryReceipt, ModeDeliverySchedule } from "../mode/types.js";

export type PendingDeliveryStatus = "pending" | "delivered" | "cancelled" | "failed";

export interface PendingDelivery {
  readonly id: string;
  readonly kind: ModeDeliveryKind;
  readonly target: unknown;
  readonly payload: unknown;
  readonly at: number;
  status: PendingDeliveryStatus;
}

export interface DeliveryQueueConfig {
  readonly root: string;
  readonly provider: ModeDeliveryProvider;
}

export class DeliveryQueue implements ModeDeliveryProvider {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private deliveries: PendingDelivery[] = [];

  constructor(private readonly config: DeliveryQueueConfig) {
    this.load();
    this.armPending();
  }

  get id(): string {
    return `delivery-queue:${this.config.provider.id}`;
  }

  get kinds(): readonly ModeDeliveryKind[] {
    return this.config.provider.kinds;
  }

  canDeliver(target: unknown): boolean {
    return this.config.provider.canDeliver ? this.config.provider.canDeliver(target) : true;
  }

  async deliver(target: unknown, payload: unknown): Promise<ModeDeliveryReceipt> {
    if (!this.config.provider.deliver) throw new Error(`Delivery provider has no deliver: ${this.config.provider.id}`);
    return this.config.provider.deliver(target, payload);
  }

  async schedule(delivery: ModeDeliverySchedule): Promise<ModeDeliveryReceipt> {
    const pending: PendingDelivery = {
      id: createId("delivery"),
      kind: delivery.kind,
      target: delivery.target,
      payload: delivery.payload,
      at: delivery.at,
      status: "pending",
    };
    this.deliveries.push(pending);
    this.save();
    this.arm(pending);
    return { id: pending.id, status: "delayed", scheduledAt: pending.at };
  }

  async cancel(id: string): Promise<boolean> {
    const pending = this.deliveries.find((item) => item.id === id);
    if (!pending || pending.status !== "pending") return false;
    pending.status = "cancelled";
    this.clearTimer(id);
    this.save();
    return true;
  }

  async dispose(): Promise<void> {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }

  private armPending(): void {
    for (const pending of this.deliveries) {
      if (pending.status === "pending") this.arm(pending);
    }
  }

  private arm(pending: PendingDelivery): void {
    const delay = Math.min(2_147_483_647, Math.max(0, pending.at - Date.now()));
    const timer = setTimeout(() => {
      void this.fire(pending.id);
    }, delay);
    timer.unref?.();
    this.timers.set(pending.id, timer);
  }

  private async fire(id: string): Promise<void> {
    const pending = this.deliveries.find((item) => item.id === id);
    if (!pending || pending.status !== "pending") return;
    this.clearTimer(id);
    if (!this.config.provider.deliver) {
      pending.status = "failed";
      this.save();
      return;
    }
    try {
      await this.config.provider.deliver(pending.target, pending.payload);
      pending.status = "delivered";
    } catch {
      pending.status = "failed";
    }
    this.save();
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  private load(): void {
    try {
      const raw = readFileSync(this.path(), "utf8");
      this.deliveries = JSON.parse(raw) as PendingDelivery[];
    } catch {
      this.deliveries = [];
    }
  }

  private save(): void {
    mkdirSync(this.config.root, { recursive: true });
    writeFileSync(this.path(), JSON.stringify(this.deliveries, null, 2), "utf8");
  }

  private path(): string {
    return join(this.config.root, "queue.json");
  }
}
