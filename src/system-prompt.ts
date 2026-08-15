import { Service } from "cordis";
import type { Context } from "cordis";

import type { Awaitable } from "./awaitable.js";
import type { Scope } from "./scope.js";

export interface PromptSection {
  name: string;
  content: string;
}

export interface ContextProvider {
  name: string;
  render(): Awaitable<string>;
}

export interface SystemPromptSnapshot {
  system: string;
  context: Readonly<Record<string, string>>;
  rendered: string;
}

export class SystemPrompt extends Service {
  static provide = "systemPrompt";

  private globalSections = new Map<string, PromptSection>();

  private scopedSections = new Map<symbol, Map<string, PromptSection>>();

  private globalContextProviders = new Map<string, ContextProvider>();

  private scopedContextProviders = new Map<symbol, Map<string, ContextProvider>>();

  constructor(ctx: Context) {
    super(ctx, "systemPrompt");
  }

  registerSection(name: string, content: string, scope: Scope = undefined): () => Promise<void> {
    if (scope) {
      const layer = this.scopedSections.get(scope) ?? new Map();
      if (layer.has(name)) throw new Error(`Prompt section already registered in scope: ${name}`);
      layer.set(name, { name, content });
      this.scopedSections.set(scope, layer);
      return this.ctx.effect(() => () => {
        layer.delete(name);
      });
    }

    if (this.globalSections.has(name)) throw new Error(`Prompt section already registered: ${name}`);
    this.globalSections.set(name, { name, content });
    return this.ctx.effect(() => () => {
      this.globalSections.delete(name);
    });
  }

  registerContextProvider(name: string, render: () => Awaitable<string>, scope: Scope = undefined): () => Promise<void> {
    const provider: ContextProvider = { name, render };
    if (scope) {
      const layer = this.scopedContextProviders.get(scope) ?? new Map();
      if (layer.has(name)) throw new Error(`Context provider already registered in scope: ${name}`);
      layer.set(name, provider);
      this.scopedContextProviders.set(scope, layer);
      return this.ctx.effect(() => () => {
        layer.delete(name);
      });
    }

    if (this.globalContextProviders.has(name)) throw new Error(`Context provider already registered: ${name}`);
    this.globalContextProviders.set(name, provider);
    return this.ctx.effect(() => () => {
      this.globalContextProviders.delete(name);
    });
  }

  async snapshot(scope: Scope = undefined): Promise<SystemPromptSnapshot> {
    const sections = merge(this.globalSections, scope ? this.scopedSections.get(scope) : undefined);
    const providers = merge(this.globalContextProviders, scope ? this.scopedContextProviders.get(scope) : undefined);

    const context: Record<string, string> = {};
    for (const [name, provider] of providers) {
      context[name] = await provider.render();
    }
    const rendered = [...providers]
      .map(([name]) => {
        return `<context name="${name}">\n${context[name]}\n</context>`;
      })
      .join("\n");

    return Object.freeze({
      system: [...sections]
        .map(([, section]) => {
          return `<section name="${section.name}">\n${section.content}\n</section>`;
        })
        .join("\n"),
      context: Object.freeze(context),
      rendered,
    });
  }
}

export const systemPrompt = {
  apply(ctx: Context) {
    new SystemPrompt(ctx);
  },
};

declare module "cordis" {
  interface Context {
    systemPrompt: SystemPrompt;
  }
}

function merge<T>(globals: Map<string, T>, scoped: Map<string, T> | undefined): Map<string, T> {
  const result = new Map(globals);
  if (scoped) {
    for (const [name, value] of scoped) {
      result.set(name, value);
    }
  }
  return result;
}
