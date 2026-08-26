/**
 * Wire types shared between the sandbox plugin and its WebUI client.
 *
 * This module must stay dependency-free: the browser bundle imports it
 * directly, outside the server's TypeScript project.
 */

/**
 * JSON-representable value, declared locally to keep this module dependency-free.
 * Structurally identical to `JsonValue` in `@athena-ai/protocol`.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

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
  data?: JsonValue;
}

/** `sandbox/life-list` — the Hub broadcasts the current Life registry. */
export interface LifeListPayload {
  lives: Array<{ id: string; name: string; description?: string }>;
}

/**
 * Sandbox Hub / Nerve protocol interfaces.
 *
 * These types define the contract between the global SandboxHub service
 * (owns the WebUI page and WebSocket routing) and per-Life SandboxNerve
 * instances (own SandboxBots in isolated Satori domains).
 */

// ---------------------------------------------------------------------------
// MessageSink — dependency-free transport abstraction
// ---------------------------------------------------------------------------

/** Abstraction over the transport that delivers bot replies to the frontend. */
export interface MessageSink {
  send(frame: { type: string; body: unknown }): void;
}

// ---------------------------------------------------------------------------
// Dispatch payload — Hub → Nerve
// ---------------------------------------------------------------------------

/** Payload the Hub passes to a Nerve's dispatch method. */
export interface SandboxDispatchPayload {
  /** WebUI client id (browser tab). */
  clientId: string;
  /** Sandbox platform identifier (unique per browser tab). */
  platform: string;
  /** User id in the sandbox session. */
  user: string;
  /** Channel (conversation) id. */
  channel: string;
  /** Message content from the user. */
  content: string;
  /** Optional quoted message. */
  quote?: { id: string; content: string; user: string };
  /** Transport for bot replies back to the originating browser tab. */
  sink: MessageSink;
}

// ---------------------------------------------------------------------------
// Nerve handle — what the Nerve exposes to the Hub
// ---------------------------------------------------------------------------

/**
 * Payload of a proxied Satori read API call.
 *
 * `platform` routes the call to the browser tab that owns the bot; `nonce` / `data` carry
 * response correlation for the `settle` pseudo-method. Everything else is method arguments.
 */
export interface SandboxRequestPayload {
  platform?: string;
  nonce?: string;
  data?: unknown;
  [key: string]: unknown;
}

/** Handle that a per-Life Sandbox Nerve exposes to the Hub. */
export interface SandboxNerveHandle {
  /** Display metadata for the Life this nerve belongs to. */
  meta: { name: string; description?: string };
  /** Hub forwards user input to this Life's sandbox domain. */
  dispatch(payload: SandboxDispatchPayload): Promise<void>;
  /** Hub proxies a Satori read API call to this Life's sandbox domain. */
  request(method: string, payload: SandboxRequestPayload): Promise<unknown>;
  /**
   * Hub reports that a browser tab is gone, so the Nerve can tear down the
   * bot it created for that tab's platform.
   */
  release(payload: { clientId: string; platform: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Hub service — what the Hub exposes globally
// ---------------------------------------------------------------------------

/** The global Sandbox Hub service interface. */
export interface SandboxHubService {
  /**
   * Register a Nerve for a Life. Returns a disposer that unregisters it.
   * Throws if `lifeId` is already registered.
   */
  register(lifeId: string, nerve: SandboxNerveHandle): () => void;
  /** List currently registered Lives. */
  lives(): Array<{ id: string; meta: SandboxNerveHandle["meta"] }>;
  /**
   * Base url of the Hub's file server, or `undefined` when it is disabled.
   * Nerves pass this to their bots so `file:` urls become fetchable links.
   */
  readonly fileBase: string | undefined;
}
