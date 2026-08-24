import { Element } from "@cordisjs/element";

import type { CQCode as CQCodeEntry } from "./types.js";

export interface CQCode extends CQCodeEntry {}

export namespace CQCode {
  export const parse = (source: string | CQCode[]): Element[] => {
    if (Array.isArray(source)) {
      return source.map(({ type, data }) => Element(type, type === "text" ? { content: data.text } : data));
    }

    const elements: Element[] = [];
    const pattern = /\[CQ:(\w+)((,\w+=[^,\]]*)*)\]/;
    let remaining = source;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(remaining))) {
      if (match.index) elements.push(Element("text", { content: unescape(match.input.slice(0, match.index)) }));
      const data: Record<string, string> = {};
      if (match[2]) {
        for (const attribute of match[2].slice(1).split(",")) {
          const index = attribute.indexOf("=");
          data[attribute.slice(0, index)] = unescape(attribute.slice(index + 1));
        }
      }
      elements.push(Element(match[1], data));
      remaining = remaining.slice(match.index + match[0].length);
    }
    if (remaining) elements.push(Element("text", { content: unescape(remaining) }));
    return elements;
  };

  const unescape = (source: string): string => {
    return source.replace(/&#91;/g, "[").replace(/&#93;/g, "]").replace(/&#44;/g, ",").replace(/&amp;/g, "&");
  };
}
