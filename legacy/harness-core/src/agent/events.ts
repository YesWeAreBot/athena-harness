import type { AssistantModelMessage } from "ai";
import type { Context } from "cordis";

import type { Agent, AgentStatus } from "./types.js";

export interface AgentStatusEvent {
  agent: Agent;
  status: AgentStatus;
}

export interface AgentErrorEvent {
  agent: Agent;
  turn?: number;
  step?: number;
  error: unknown;
}

export interface AgentStreamPartEvent {
  agent: Agent;
  part: unknown;
}

export interface AgentOutputEvent {
  agent: Agent;
  kind: "text-delta" | "assistant-message";
  text?: string;
  message?: AssistantModelMessage;
}

interface AgentStatusCordisEvent {
  agent: unknown;
  status: AgentStatus;
}

interface AgentErrorCordisEvent {
  agent: unknown;
  turn?: number;
  step?: number;
  error: unknown;
}

interface AgentStreamPartCordisEvent {
  agent: unknown;
  part: unknown;
}

interface AgentOutputCordisEvent {
  agent: unknown;
  kind: "text-delta" | "assistant-message";
  text?: string;
  message?: AssistantModelMessage;
}

export interface AgentEventMap {
  "agent/status"(event: AgentStatusEvent): void;
  "agent/error"(event: AgentErrorEvent): void;
  "agent/stream-part"(event: AgentStreamPartEvent): void;
  "agent/output"(event: AgentOutputEvent): void;
}

export interface AgentEventSubject {
  on<K extends keyof AgentEventMap>(name: K, listener: AgentEventMap[K]): () => void;
  once<K extends keyof AgentEventMap>(name: K, listener: AgentEventMap[K]): () => void;
}

interface AgentBoundEvent {
  agent: Agent;
}

export function agentEvents(ctx: Context, agent: Agent): AgentEventSubject {
  const subscribe = <K extends keyof AgentEventMap>(name: K, listener: AgentEventMap[K], once: boolean): (() => void) => {
    const handler = (payload: AgentBoundEvent) => {
      if (payload.agent !== agent) return;
      (listener as (event: AgentBoundEvent) => void)(payload);
    };
    return once ? ctx.once(name as never, handler as never) : ctx.on(name as never, handler as never);
  };

  return {
    on: (name, listener) => subscribe(name, listener, false),
    once: (name, listener) => subscribe(name, listener, true),
  };
}

declare module "cordis" {
  interface Events {
    "agent/status"(event: AgentStatusCordisEvent): void;
    "agent/error"(event: AgentErrorCordisEvent): void;
    "agent/stream-part"(event: AgentStreamPartCordisEvent): void;
    "agent/output"(event: AgentOutputCordisEvent): void;
  }
}
