import type { Element } from "@satorijs/element";
import { h, type VNodeChild } from "vue";

/** Element types that map straight onto an inline HTML tag. */
const INLINE_TAGS: Record<string, true> = {
  b: true,
  code: true,
  del: true,
  em: true,
  i: true,
  ins: true,
  s: true,
  strong: true,
  u: true,
};

/** Turn a parsed Satori message into renderable Vue children. */
export function renderElements(elements: Element[]): VNodeChild[] {
  return elements.map(({ type, attrs, children }): VNodeChild => {
    if (type === "text") return attrs.content;
    if (type === "at") return h("span", `@${attrs.name ?? attrs.id}`);
    if (type === "img") return h("img", { src: attrs.src, alt: attrs.alt });
    if (type === "audio") return h("audio", { src: attrs.src, controls: true });
    if (type === "video") return h("video", { src: attrs.src, controls: true });
    if (INLINE_TAGS[type]) return h(type, renderElements(children));
    if (type === "spl") return h("span", { class: "spoiler" }, renderElements(children));
    if (type === "p" || type === "message") return h("p", renderElements(children));
    if (type === "iframe") return h("iframe", { innerHTML: attrs.content });
    return renderElements(children);
  });
}

export default renderElements;
