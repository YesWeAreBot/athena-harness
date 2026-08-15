import { createId, deepFreeze } from "@yesimbot/harness-core";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { Body, PerceptEvent } from "./types.js";

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
    });
  }

  get(id: string): Body | undefined {
    return this.bodies.get(id);
  }

  list(): Body[] {
    return [...this.bodies.values()];
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
  }
}
