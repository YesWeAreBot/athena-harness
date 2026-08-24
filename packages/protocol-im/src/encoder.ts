import type { Body } from "@athena-ai/protocol";
import type { Element } from "@cordisjs/element";

import type { Message, SendOptions } from "./types.js";

/** Base class for IM message encoders. */
export abstract class MessageEncoder<B extends Body = Body> {
  public errors: Error[] = [];
  public results: Message[] = [];

  constructor(
    public body: B,
    public channelId: string,
    public options: SendOptions = {},
  ) {}

  /** Called before rendering starts. */
  async prepare(): Promise<void> {}

  /** Send accumulated content to the platform. */
  abstract flush(): Promise<void>;

  /** Process a single element. */
  abstract visit(element: Element): Promise<void>;

  /** Render a list of elements, optionally flushing at the end. */
  async render(elements: Element[], flush?: boolean): Promise<void> {
    for (const element of elements) {
      await this.visit(element);
    }
    if (flush) await this.flush();
  }

  /** Normalize content, render it, flush it, and return messages. */
  async send(elements: Element[]): Promise<Message[]> {
    await this.prepare();
    await this.render(elements);
    await this.flush();
    if (this.errors.length) throw new AggregateError(this.errors, "MessageEncoder errors");
    return this.results;
  }
}
