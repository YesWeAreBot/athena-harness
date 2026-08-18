import type { Session } from "@athena/session";
import type { ModelMessage } from "ai";

import type { PerceptEvent } from "../body/types.js";
import type { Awaitable } from "../internal.js";
import type { Life } from "../life/types.js";
import type { LifeMemory } from "../memory/index.js";
import type { ModeDeliveryKind } from "../mode/types.js";

export type TriggerKind = "event" | "continuous" | "scheduled" | "wake" | "custom";

export interface ModeTrigger {
  readonly kinds: readonly TriggerKind[];
  readonly eventInterests?: readonly { readonly body?: string; readonly kind?: string }[];
  readonly scheduling?: readonly string[];
}

export interface ContextAssemblyInput {
  readonly percept?: PerceptEvent;
  readonly session: Session;
  readonly life: Life;
  readonly memory?: LifeMemory;
}

export interface ContextAssembler {
  readonly id: string;
  build(input: ContextAssemblyInput, signal?: AbortSignal): Awaitable<ContextSnapshot>;
}

export interface ContextSnapshot {
  readonly system?: string;
  readonly messages: readonly ModelMessage[];
  readonly fingerprint?: string;
}

export interface ExecutionInput {
  readonly context: ContextSnapshot;
  readonly percept?: PerceptEvent;
  readonly session: Session;
  readonly life: Life;
  readonly signal?: AbortSignal;
}

export type ExecutionKind = "agent-loop" | "structured-output" | "custom";

export interface ExecutionDriver {
  readonly id: string;
  readonly kind: ExecutionKind;
  execute(input: ExecutionInput): Awaitable<ExecutionResult>;
}

export interface ExecutionResult {
  readonly kind: string;
  readonly output: unknown;
  readonly raw?: unknown;
}

export interface ResultInterpreter {
  readonly id: string;
  interpret(result: ExecutionResult, input: ExecutionInput): Awaitable<InterpretedResult>;
}

export interface InterpretedResult {
  readonly effects: readonly EffectAction[];
  readonly continuation?: ContinuationPlan;
  readonly output?: unknown;
}

export type EffectAction =
  | {
      readonly type: "session-append";
      readonly eventType: string;
      readonly data: unknown;
      readonly surfaceOp?: "append" | { readonly replace: { readonly start: number; readonly end: number } };
    }
  | {
      readonly type: "deliver";
      readonly kind: ModeDeliveryKind;
      readonly target: unknown;
      readonly payload: unknown;
    }
  | {
      readonly type: "state-set";
      readonly providerId: string;
      readonly value: unknown;
    }
  | {
      readonly type: "actuator";
      readonly bodyId: string;
      readonly actuatorId: string;
      readonly action: unknown;
    }
  | {
      readonly type: "custom";
      readonly providerId: string;
      readonly action: string;
      readonly payload: unknown;
    };

export interface EffectHandler {
  readonly id: string;
  handle(action: EffectAction, input: ExecutionInput): Awaitable<void>;
}

export type ContinuationKind = "none" | "continue" | "schedule" | "custom";

export interface ContinuationPlan {
  readonly kind: ContinuationKind;
  readonly at?: number;
  readonly after?: number;
  readonly interval?: number;
  readonly payload?: unknown;
}

export interface ModePipeline {
  readonly id: string;
  readonly trigger: ModeTrigger;
  readonly context: ContextAssembler;
  readonly execution: ExecutionDriver;
  readonly interpret: ResultInterpreter;
  readonly effects: readonly EffectHandler[];
  readonly continuation?: (plan: ContinuationPlan, input: ExecutionInput) => Awaitable<void>;
}
