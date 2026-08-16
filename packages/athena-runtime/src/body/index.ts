import { Service } from "cordis";
import type { Context } from "cordis";

import { createId, deepFreeze } from "../internal.js";
import type { ActuatorOptions, ActuatorResult, Body, BodyAdapter, PerceptEvent, PerceptEventOptions } from "./types.js";

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
      state: adapter.state ?? {},
      ...(adapter.senses === undefined ? {} : { senses: adapter.senses }),
      ...(adapter.actuators === undefined ? {} : { actuators: adapter.actuators }),
    };
    const dispose = this.register(body);
    try {
      await adapter.start?.({ body });
    } catch (error) {
      dispose();
      throw error;
    }
    return async () => {
      try {
        await adapter.stop?.();
      } finally {
        dispose();
      }
    };
  }

  get(id: string): Body | undefined {
    return this.bodies.get(id);
  }

  list(): Body[] {
    return [...this.bodies.values()];
  }

  async act(bodyId: string, actuatorId: string, action: unknown, options: ActuatorOptions = {}): Promise<ActuatorResult> {
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

    const attempts = Math.max(0, options.retries ?? 0) + 1;
    let lastResult: ActuatorResult = { status: "error", error: new Error("Actuator did not run"), retryable: true };
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (options.signal?.aborted) {
        lastResult = { status: "canceled", error: options.signal.reason, retryable: false };
        break;
      }
      try {
        const raw = await actuator.act(action, {
          bodyId,
          signal: options.signal,
          attempt,
          ...(options.lifeId === undefined ? {} : { lifeId: options.lifeId }),
          ...(options.modeId === undefined ? {} : { modeId: options.modeId }),
          ...(options.delivery === undefined ? {} : { delivery: options.delivery }),
          ...(options.media === undefined ? {} : { media: options.media }),
        });
        const result = normalizeActuatorResult(raw);
        if (result.status === "error" && result.retryable !== false && attempt + 1 < attempts) {
          lastResult = result;
          continue;
        }
        this.ctx.emit("actuator/executed", { bodyId, actuatorId, kind: actuator.kind, result, attempt });
        return result;
      } catch (error) {
        lastResult = { status: "error", error, retryable: true };
      }
    }
    this.ctx.emit("actuator/executed", { bodyId, actuatorId, kind: actuator.kind, result: lastResult, attempt: attempts - 1 });
    return lastResult;
  }

  dispatch<T>(bodyId: string, kind: string, data: T, options: PerceptEventOptions = {}): PerceptEvent<T> {
    if (!this.bodies.has(bodyId)) {
      throw new Error(`Body not registered: ${bodyId}`);
    }
    const event = Object.freeze({
      id: createId("percept"),
      time: Date.now(),
      bodyId,
      kind,
      data: deepFreeze(data),
      ...(options.source === undefined ? {} : { source: options.source }),
      ...(options.priority === undefined ? {} : { priority: options.priority }),
      ...(options.expiresAt === undefined ? {} : { expiresAt: options.expiresAt }),
      ...(options.actor === undefined ? {} : { actor: Object.freeze(options.actor) }),
      ...(options.target === undefined ? {} : { target: Object.freeze(options.target) }),
      ...(options.attachments === undefined ? {} : { attachments: Object.freeze([...options.attachments]) }),
      ...(options.meta === undefined ? {} : { meta: deepFreeze(options.meta) }),
    }) as PerceptEvent<T>;
    this.ctx.emit("body/percept", event);
    return event;
  }
}

function normalizeActuatorResult(value: unknown): ActuatorResult {
  if (value && typeof value === "object" && "status" in value) {
    const status = (value as { status?: unknown }).status;
    if (status === "ok" || status === "error" || status === "canceled") {
      return value as ActuatorResult;
    }
  }
  return { status: "ok", output: value };
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
    "actuator/executed"(event: { bodyId: string; actuatorId: string; kind?: string; result: ActuatorResult; attempt: number }): void;
  }
}
