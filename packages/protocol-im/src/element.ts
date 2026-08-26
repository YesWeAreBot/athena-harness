/**
 * Re-export @cordisjs/element with convenience factories for IM use.
 */
export { default } from "@cordisjs/element";
export * from "@cordisjs/element";

import { Element } from "@cordisjs/element";

/** Create an `<at>` element targeting a user by ID. */
export function at(id: string, attrs?: Record<string, string>): Element {
  return Element("at", { id, ...attrs });
}

/** Create an `<at type="all">` element. */
export function atAll(): Element {
  return Element("at", { type: "all" });
}

/** Create a `<sharp>` (channel mention) element. */
export function sharp(id: string): Element {
  return Element("sharp", { id });
}

/** Create a `<quote>` element referencing a message. */
export function quote(id: string): Element {
  return Element("quote", { id });
}

/** Create an `<img>` element. */
export function image(src: string, attrs?: Record<string, string>): Element {
  return Element("img", { src, ...attrs });
}

/** Create a `<video>` element. */
export function video(src: string, attrs?: Record<string, string>): Element {
  return Element("video", { src, ...attrs });
}

/** Create an `<audio>` element. */
export function audio(src: string, attrs?: Record<string, string>): Element {
  return Element("audio", { src, ...attrs });
}

/** Create a `<file>` element. */
export function file(src: string, attrs?: Record<string, string>): Element {
  return Element("file", { src, ...attrs });
}

/**
 * Whether the session mentions the current login via `<at id={selfId}>`.
 *
 * Agents import this instead of inlining the Element traversal.
 */
export function isAtSelf(session: { elements?: readonly Element[]; selfId?: string }): boolean {
  const elements = session.elements;
  if (!elements || !session.selfId) return false;
  for (const el of elements) {
    // oxlint-disable-next-line anti-slop/no-unsafe-member-access -- Element.attrs has no index signature; "id" is a known at-element attribute
    if (el.type === "at" && String((el.attrs as Record<string, unknown>).id) === session.selfId) return true;
  }
  return false;
}
