/**
 * Cortex Hook Protocol.
 *
 * These hooks are optional mounting points that a Cortex may choose to emit.
 * Listening plugins must tolerate a Cortex that emits none of them.
 *
 * Waterfall hooks follow Cordis v4 semantics: the listener receives the
 * payload plus a `next` callback, mutates the payload in place when needed,
 * and must call `next()` to continue down the chain.
 */

/** A perception event entering a Cortex integration phase. */
export interface PerceptionEvent {
  /** Stable event id for correlation. */
  readonly id: string;
  /** Discriminant, e.g. `message-created` or `minecraft/block-change`. */
  readonly type: string;
  /** Source identifier, typically a Nerve body sid. */
  readonly source: string;
  /** When the event occurred, in milliseconds. */
  readonly timestamp: number;
}

/** Mutable context assembled by a Cortex before cognition. */
export interface CortexContext {
  /** Correlation id shared by all hooks of one Cortex cycle. */
  readonly cycleId: string;
  /** Events that contributed to this cycle. */
  readonly events: readonly PerceptionEvent[];
  /** Optional Life id for traceability. */
  readonly lifeId?: string;
  /** Ordered context sections; extension plugins may append content here. */
  sections: string[];
}

/** JSON-safe model settings accepted by the AI SDK call. */
export type CognitionSetting = string | number | boolean | null;

/** Model settings that a `cortex/before-cognition` hook may adjust. */
export type CognitionSettings = Record<string, CognitionSetting>;

/** Mutable LLM call parameters before cognition starts. */
export interface CognitionParams {
  /** Correlation id shared by all hooks of one Cortex cycle. */
  readonly cycleId: string;
  /** The assembled context for this cycle. */
  readonly context: CortexContext;
  /** Optional model group or alias selected by the Cortex. */
  readonly model?: string;
  /** System prompt passed to the model. */
  systemPrompt: string;
  /** Tool names currently exposed to the model. */
  tools: string[];
  /** Model call settings; call-site values win over registry defaults. */
  settings: CognitionSettings;
}

/** Structured payload attached to an action emitted for enactment. */
export interface CortexActionData {
  readonly channelId?: string;
  readonly userId?: string;
  readonly content?: string;
}

/** An action a Cortex intends to perform. */
export interface CortexAction {
  /** Stable action id for correlation. */
  readonly id: string;
  /** Product-semantic action type, e.g. `send_message`. */
  readonly type: string;
  /** Optional explicit target, such as a Nerve body sid. */
  readonly target?: string;
  /** Convenience text view for guard plugins that only need content. */
  readonly text?: string;
  /** Structured payload for typed consumers. */
  readonly data?: CortexActionData;
}

/** A structured verdict that short-circuits `cortex/before-enact`. */
export interface CortexEnactVerdict {
  readonly vetoed: true;
  readonly reason: string;
}

/** Result of one enacted action. */
export interface EnactResult {
  /** Matches the originating `CortexAction.id`. */
  readonly actionId: string;
  readonly ok: boolean;
  readonly error?: string;
}

declare module "cordis" {
  interface Events {
    "cortex/before-drain"(events: PerceptionEvent[], next: () => PerceptionEvent[]): PerceptionEvent[];
    "cortex/after-integrate"(context: CortexContext, next: () => CortexContext): CortexContext;
    "cortex/before-cognition"(params: CognitionParams, next: () => CognitionParams): CognitionParams;
    "cortex/before-enact"(action: CortexAction): CortexEnactVerdict | void;
    "cortex/after-enact"(results: EnactResult[]): void;
  }
}
