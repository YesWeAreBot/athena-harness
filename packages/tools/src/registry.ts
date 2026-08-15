import type { Tool, ToolSet } from "ai";
import { Service } from "cordis";
import type { Context } from "cordis";

declare module "cordis" {
  interface Context {
    tools: ToolRegistry;
  }
}

export class ToolRegistry extends Service {
  static provide = "tools";

  private _globals = new Map<string, Tool>();
  private _scoped = new Map<symbol, Map<string, Tool>>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  /**
   * Register a tool globally (key undefined) or scoped to an agent (key = agentKey symbol).
   * Returns a Cordis-effect cleanup function.
   * Throws on duplicate name within the same scope.
   */
  register(name: string, tool: Tool, key?: symbol): () => void {
    if (key !== undefined) {
      const layer = this._scoped.get(key) ?? new Map<string, Tool>();
      if (layer.has(name)) throw new Error(`Tool already registered in scope: ${name}`);
      layer.set(name, tool);
      this._scoped.set(key, layer);
      return this.ctx.effect(() => () => {
        layer.delete(name);
      });
    }
    if (this._globals.has(name)) throw new Error(`Tool already registered: ${name}`);
    this._globals.set(name, tool);
    return this.ctx.effect(() => () => {
      this._globals.delete(name);
    });
  }

  /**
   * Returns a merged ToolSet with `execute` stripped from every entry.
   * Passing to streamText makes AI SDK stop when it calls one of these tools
   * (descriptor-only pattern — spec decision A2).
   */
  descriptors(key?: symbol, activeTools?: ReadonlySet<string>): ToolSet {
    return this._build(key, activeTools, false);
  }

  /** Returns a merged ToolSet with `execute` intact — used by the loop to run tools. */
  executors(key?: symbol, activeTools?: ReadonlySet<string>): ToolSet {
    return this._build(key, activeTools, true);
  }

  names(key?: symbol): string[] {
    const merged = this._merge(key);
    return [...merged.keys()];
  }

  // ── private ───────────────────────────────────────────────────────────────

  private _merge(key?: symbol): Map<string, Tool> {
    const result = new Map<string, Tool>(this._globals);
    if (key !== undefined) {
      for (const [name, tool] of this._scoped.get(key) ?? []) {
        result.set(name, tool);
      }
    }
    return result;
  }

  private _build(key: symbol | undefined, activeTools: ReadonlySet<string> | undefined, keepExecute: boolean): ToolSet {
    const merged = this._merge(key);
    const result: Record<string, Tool> = {};
    for (const [name, tool] of merged) {
      if (activeTools && !activeTools.has(name)) continue;
      if (keepExecute) {
        result[name] = tool;
      } else {
        // Strip execute so AI SDK treats this as a pure declaration
        const { execute: _execute, ...rest } = tool as Tool & { execute?: unknown };
        result[name] = rest as Tool;
      }
    }
    return result as ToolSet;
  }
}
