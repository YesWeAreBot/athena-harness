import type { Tool, ToolSet } from "ai";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { Scope } from "./scope.js";

export class ToolRuntime extends Service {
  static provide = "tools";

  private globals = new Map<string, Tool>();

  private scoped = new Map<symbol, Map<string, Tool>>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  register(name: string, tool: Tool, scope: Scope = undefined): () => Promise<void> {
    if (scope) {
      const layer = this.scoped.get(scope) ?? new Map();
      if (layer.has(name)) throw new Error(`Tool already registered in scope: ${name}`);
      layer.set(name, tool);
      this.scoped.set(scope, layer);
      return this.ctx.effect(() => () => {
        layer.delete(name);
      });
    }

    if (this.globals.has(name)) throw new Error(`Tool already registered: ${name}`);
    this.globals.set(name, tool);
    return this.ctx.effect(() => () => {
      this.globals.delete(name);
    });
  }

  snapshot(scope: Scope = undefined): ToolSet {
    const result: Record<string, Tool> = Object.fromEntries(this.globals);
    if (scope) {
      for (const [name, tool] of this.scoped.get(scope) ?? []) {
        result[name] = tool;
      }
    }
    return Object.freeze(result) as ToolSet;
  }
}

export const toolRuntime = {
  apply(ctx: Context) {
    new ToolRuntime(ctx);
  },
};

declare module "cordis" {
  interface Context {
    tools: ToolRuntime;
  }
}
