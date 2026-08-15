import type { Awaitable } from "@yesimbot/harness-core";

import type { PerceptEvent } from "../body/types.js";

export interface ModeContext {}

export interface Mode<C = any> {
  name: string;
  setup(ctx: ModeContext, config: C): Awaitable<ModeHandle>;
}

export interface ModeHandle {
  start?(): Awaitable<void>;
  stop?(): Awaitable<void>;
  handle?(event: PerceptEvent): Awaitable<boolean>;
}
