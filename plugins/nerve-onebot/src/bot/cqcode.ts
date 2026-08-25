import { Element } from "@cordisjs/element";

import type { CQCode as CQCodeEntry } from "../types.js";

export interface CQCode extends CQCodeEntry {}

export namespace CQCode {
  /**
   * Escape a value for embedding in CQCode text.
   * When `inline` is set, also escapes commas (for use inside `[CQ:...]`).
   */
  export const escape = (source: string, inline = false): string => {
    const result = source.replace(/&/g, "&amp;").replace(/\[/g, "&#91;").replace(/\]/g, "&#93;");
    return inline ? result.replace(/,/g, "&#44;") : result;
  };

  export const unescape = (source: string): string => {
    return String(source).replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");
  };

  /** Serialize a CQCode entry (or text) back to the `[CQ:...]` wire format. */
  export const encode = (type: string, attrs: Record<string, string> = {}): string => {
    if (type === "text") return attrs.text ?? "";
    let output = `[CQ:${type}`;
    for (const key in attrs) {
      if (attrs[key]) output += `,${key}=${escape(attrs[key], true)}`;
    }
    return `${output}]`;
  };

  const pattern = /\[CQ:(\w+)((,\w+=[^,\]]*)*)\]/;

  const from = (source: string): { type: string; data: Record<string, string>; capture: RegExpExecArray } | null => {
    const capture = pattern.exec(source);
    if (!capture) return null;
    const [, type, attrs] = capture;
    const data: Record<string, string> = {};
    if (attrs) {
      for (const attribute of attrs.slice(1).split(",")) {
        const index = attribute.indexOf("=");
        data[attribute.slice(0, index)] = unescape(attribute.slice(index + 1));
      }
    }
    return { type, data, capture };
  };

  export const parse = (source: string | CQCode[]): Element[] => {
    if (Array.isArray(source)) {
      return source.map(({ type, data }) => Element(type, type === "text" ? { content: data.text } : data));
    }

    const elements: Element[] = [];
    let remaining = source;
    let result: ReturnType<typeof from>;
    while ((result = from(remaining))) {
      const { type, data, capture } = result;
      if (capture.index) elements.push(Element("text", { content: unescape(remaining.slice(0, capture.index)) }));
      elements.push(Element(type, data));
      remaining = remaining.slice(capture.index + capture[0].length);
    }
    if (remaining) elements.push(Element("text", { content: unescape(remaining) }));
    return elements;
  };
}
