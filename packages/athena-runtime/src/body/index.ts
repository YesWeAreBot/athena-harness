import { createId, deepFreeze } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { Body, BodyAdapter, PerceptEvent } from "./types.js";

export class BodyRegistry extends Service {
  static provide = "bodies";

  private bodies = new Map<string, Body>();

  constructor(ctx: Context) {
    super(ctx, "bodies");
    this.ctx.effect(() => () => {
      this.bodies.clear();
    });
  }

  register(body: Body): () => Promise<void> {
    if (this.bodies.has(body.id)) {
      throw new Error(`Body already registered: ${body.id}`);
    }
    this.bodies.set(body.id, body);
    return this.ctx.effect(() => () => {
      this.bodies.delete(body.id);
      this.ctx.emit("body/disposed", { id: body.id });
    });
  }

  async registerAdapter(adapter: BodyAdapter): Promise<() => Promise<void>> {
    const body: Body = {
      id: adapter.id,
      ...(adapter.name === undefined ? {} : { name: adapter.name }),
      state: {},
      ...(adapter.senses === undefined ? {} : { senses: adapter.senses }),
      ...(adapter.actuators === undefined ? {} : { actuators: adapter.actuators }),
    };
    const dispose = this.register(body);
    await adapter.start?.({ body });
    return async () => {
      await adapter.stop?.();
      dispose();
    };
  }

  get(id: string): Body | undefined {
    return this.bodies.get(id);
  }

  list(): Body[] {
    return [...this.bodies.values()];
  }

  async act(bodyId: string, actuatorId: string, action: unknown): Promise<unknown> {
    const body = this.bodies.get(bodyId);
    if (!body) {
      throw new Error(`Body not registered: ${bodyId}`);
    }
    const actuator = body.actuators?.find((item) => item.id === actuatorId);
    if (!actuator) {
      throw new Error(`Actuator not found: ${bodyId}/${actuatorId}`);
    }
    if (!actuator.act) {
      throw new Error(`Actuator has no act implementation: ${bodyId}/${actuatorId}`);
    }
    return await actuator.act(action);
  }

  dispatch<T>(bodyId: string, kind: string, data: T): PerceptEvent<T> {
    if (!this.bodies.has(bodyId)) {
      throw new Error(`Body not registered: ${bodyId}`);
    }
    const event = Object.freeze({
      id: createId("percept"),
      time: Date.now(),
      bodyId,
      kind,
      data: deepFreeze(data),
    }) as PerceptEvent<T>;
    this.ctx.emit("body/percept", event);
    return event;
  }
}

export const bodyRegistry = {
  apply(ctx: Context) {
    new BodyRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    bodies: BodyRegistry;
  }

  interface Events {
    "body/percept"(event: PerceptEvent): void;
    "body/disposed"(event: { id: string }): void;
  }
}
