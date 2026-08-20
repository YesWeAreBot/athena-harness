/**
 * Wire types shared between the sandbox plugin and its WebUI client.
 *
 * This module must stay dependency-free: the browser bundle imports it
 * directly, outside the server's TypeScript project.
 */

/** A single chat bubble, as exchanged with the sandbox page. */
export interface Message {
  id: string;
  lifeId: string;
  user: string;
  channel: string;
  content: string;
  platform: string;
  quote?: Message;
}

/** `sandbox/send-message` — the page relays user input to the harness. */
export interface SendMessagePayload {
  lifeId: string;
  platform: string;
  user: string;
  channel: string;
  content: string;
  quote?: Message;
}

/** `sandbox/delete-message` — the page retracts one of its own bubbles. */
export interface DeleteMessagePayload {
  lifeId: string;
  platform: string;
  user: string;
  channel: string;
  messageId: string;
}

/** `sandbox/request` — the harness calls a Satori read API on the page. */
export interface RequestPayload {
  lifeId: string;
  method: string;
  data: Record<string, string>;
  nonce: string;
}

/** `sandbox/response` — the page answers a `sandbox/request`. */
export interface ResponsePayload {
  lifeId: string;
  platform: string;
  nonce: string;
  data?: unknown;
}

/** `sandbox/life-list` — the Hub broadcasts the current Life registry. */
export interface LifeListPayload {
  lives: { id: string; name: string; description?: string }[];
}
