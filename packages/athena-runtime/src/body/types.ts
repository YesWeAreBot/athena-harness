import type { Awaitable } from "@yesimbot/harness-core";

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

export interface PerceptEvent<T = unknown> {
  readonly id: string;
  readonly time: number;
  readonly bodyId: string;
  readonly kind: string;
  readonly data: T;
}
