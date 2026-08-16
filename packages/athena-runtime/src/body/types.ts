import type { Awaitable } from "../internal.js";

export interface Body {
  readonly id: string;
  readonly name?: string;
  readonly state: Readonly<Record<string, unknown>>;
  readonly senses?: readonly Sense[];
  readonly actuators?: readonly Actuator[];
}

export interface Sense {
  readonly id: string;
  readonly kind?: string;
}

export interface Actuator {
  readonly id: string;
  readonly kind?: string;
  act?(action: unknown): Awaitable<unknown>;
}

export interface BodyAdapterContext {
  readonly body: Body;
}

/**
 * @experimental A BodyAdapter is the bridge between an existing platform adapter (OneBot,
 * Satori, etc.) and a Life Body. It must not implement Mode behavior.
 */
export interface BodyAdapter {
  readonly id: string;
  readonly name?: string;
  readonly senses?: readonly Sense[];
  readonly actuators?: readonly Actuator[];
  start?(context: BodyAdapterContext): Awaitable<void>;
  stop?(): Awaitable<void>;
}

export interface PerceptEvent<T = unknown> {
  readonly id: string;
  readonly time: number;
  readonly bodyId: string;
  readonly kind: string;
  readonly data: T;
}
