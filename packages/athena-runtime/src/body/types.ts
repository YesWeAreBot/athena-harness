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

export type ActuatorStatus = "ok" | "error" | "canceled";

export interface ActuatorResult {
  readonly status: ActuatorStatus;
  readonly output?: unknown;
  readonly error?: unknown;
  readonly retryable?: boolean;
}

export interface ActuatorContext {
  readonly bodyId: string;
  readonly signal?: AbortSignal;
  readonly attempt: number;
  readonly lifeId?: string;
  readonly modeId?: string;
  readonly delivery?: unknown;
  readonly media?: unknown;
}

export interface ActuatorOptions {
  readonly signal?: AbortSignal;
  readonly retries?: number;
  readonly lifeId?: string;
  readonly modeId?: string;
  readonly delivery?: unknown;
  readonly media?: unknown;
}

export interface Actuator {
  readonly id: string;
  readonly kind?: string;
  act?(action: unknown, context?: ActuatorContext): Awaitable<ActuatorResult>;
}

export interface BodyAdapterContext {
  readonly body: Body;
  readonly dispatch: <T>(kind: string, data: T, options?: PerceptEventOptions) => PerceptEvent<T>;
  readonly patchState: (patch: Readonly<Record<string, unknown>>) => void;
}

/**
 * @experimental A BodyAdapter is the bridge between an existing platform adapter (OneBot,
 * Satori, etc.) and a Life Body. It must not implement Mode behavior.
 */
export interface BodyAdapter {
  readonly id: string;
  readonly name?: string;
  readonly state?: Readonly<Record<string, unknown>>;
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
  readonly source?: string;
  readonly priority?: number;
  readonly expiresAt?: number;
  readonly actor?: PerceptActor;
  readonly target?: PerceptTarget;
  readonly attachments?: readonly MediaRef[];
  readonly meta?: Readonly<Record<string, unknown>>;
}

export interface PerceptActor {
  readonly id: string;
  readonly name?: string;
}

export interface PerceptTarget {
  readonly id: string;
  readonly kind?: string;
}

export interface MediaRef {
  readonly id: string;
  readonly type: "image" | "audio" | "video" | "file";
  readonly mime?: string;
  readonly uri?: string;
}

export interface PerceptEventOptions {
  readonly source?: string;
  readonly priority?: number;
  readonly expiresAt?: number;
  readonly actor?: PerceptActor;
  readonly target?: PerceptTarget;
  readonly attachments?: readonly MediaRef[];
  readonly meta?: Readonly<Record<string, unknown>>;
}
