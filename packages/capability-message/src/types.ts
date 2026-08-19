import type { Bot, Session } from "@satorijs/core";
import type { Fragment } from "@satorijs/element";
import type { SendOptions, Message } from "@satorijs/protocol";

export type { Bot, Session };
export type { Message, SendOptions };
export type { Fragment };

export interface AdapterConfig {
  name: string;
  config?: Record<string, unknown>;
}

export interface MessageServiceConfig {
  adapters?: AdapterConfig[];
}
