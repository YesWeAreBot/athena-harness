import type { Body } from "@athena-ai/protocol";
import type { Element, Fragment } from "@cordisjs/element";
import { normalize } from "@cordisjs/element";

import type { Message, SendOptions } from "./types.js";

class AggregateError extends Error {
  constructor(
    public errors: Error[],
    message = "",
  ) {
    super(message);
  }
}

/**
 * Base class for IM message encoding.
 * Adapters extend this to convert Element trees into platform-specific payloads.
 */
export abstract class MessageEncoder<B extends Body = Body> {
  public errors: Error[] = [];
  public results: Message[] = [];

  constructor(
    public body: B,
    public channelId: string,
    public options: SendOptions = {},
  ) {}

  /** Called once before rendering starts. Override for setup logic. */
  async prepare(): Promise<void> {}

  /** Flush buffered content to platform. */
  abstract flush(): Promise<void>;

  /** Visit a single element. Called recursively for tree traversal. */
  abstract visit(element: Element): Promise<void>;

  /** Render a list of elements, optionally flushing at the end. */
  async render(elements: Element[], flush?: boolean): Promise<void> {
    for (const element of elements) {
      await this.visit(element);
    }
    if (flush) {
      await this.flush();
    }
  }

  /** Main entry point: normalize content, prepare, render, flush. */
  async send(content: Fragment): Promise<Message[]> {
    const elements = normalize(content);
    await this.prepare();
    await this.render(elements);
    await this.flush();
    if (this.errors.length) {
      throw new AggregateError(this.errors);
    }
    return this.results;
  }
}
