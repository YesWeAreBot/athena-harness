/**
 * JSON-representable values.
 *
 * Everything that crosses a serialization boundary — memory entries, persona traits,
 * Satori API payloads proxied through the sandbox transport — is described with these
 * types instead of `unknown` / `any`, so callers get a concrete value contract without
 * the framework pretending to know more than the wire format guarantees.
 */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

/** A JSON object: string keys, JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}
