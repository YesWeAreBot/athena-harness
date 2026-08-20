/**
 * Wire types shared between the sandbox plugin and its WebUI client.
 *
 * This module must stay dependency-free: the browser bundle imports it
 * directly, outside the server's TypeScript project.
 */

/** A single chat bubble, as exchanged with the sandbox page. */
export interface Message {
  id: string;
  user: string;
  channel: string;
  content: string;
  platform: string;
  quote?: Message;
}

/** `sandbox/send-message` — the page relays user input to the harness. */
export interface SendMessagePayload {
  platform: string;
  user: string;
  channel: string;
  content: string;
  quote?: Message;
}

/** `sandbox/delete-message` — the page retracts one of its own bubbles. */
export interface DeleteMessagePayload {
  platform: string;
  user: string;
  channel: string;
  messageId: string;
}

/** `sandbox/request` — the harness calls a Satori read API on the page. */
export interface RequestPayload {
  method: string;
  data: Record<string, string>;
  nonce: string;
}

/** `sandbox/response` — the page answers a `sandbox/request`. */
export interface ResponsePayload {
  platform: string;
  nonce: string;
  data?: unknown;
}
