import { Tool, ToolSet } from "@athena-ai/ai";
import { Context, Service } from "cordis";

const CALLER = Symbol.for("cordis.caller");

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- intentional: accept any AI SDK tool shape; the caller chooses the concrete Tool/ToolSet produced by `tool()` / provider tool factories
type AnyTool = Tool<any, any, any>;

interface Entry {
  tool: AnyTool;
  scope: string | null; // null = global (visible to all), otherwise the Life `id` that registered it
}

function scopeOf(caller: Context): string | null {
  try {
    // LifeService is always available inside a Life group; outside it throws
    // "cannot get property 'life' without inject" which we treat as global.
    const life = (caller as unknown as { life: { id: string } | undefined }).life;
    return life?.id ?? null;
  } catch {
    return null;
  }
}

export class ToolRegistry extends Service {
  /** Partitioned by scope so the same name can exist in different Lives. */
  private readonly byScope = new Map<string | null, Map<string, Entry>>();

  constructor(ctx: Context) {
    super(ctx, "tools");
  }

  private scopeMap(scope: string | null): Map<string, Entry> {
    let m = this.byScope.get(scope);
    if (!m) {
      m = new Map();
      this.byScope.set(scope, m);
    }
    return m;
  }

  /**
   * Register a tool under `name`.
   *
   * Scope is derived automatically from the caller's `life.id`. Root/global
   * (no Life) → visible to every Life; inside a Life group → only that
   * Life. Throw when `name` already exists in the same scope unless
   * `override: true`.
   *
   * Returns an unregister function and registers a self-disposing effect on
   * the caller's fiber so plugin dispose removes the entry automatically.
   */
  register(name: string, tool: AnyTool, options: { override?: boolean } = {}): () => void {
    const caller: Context | undefined = (this as unknown as Record<symbol, Context>)[CALLER];
    const scope = caller ? scopeOf(caller) : null;
    const map = this.scopeMap(scope);
    const existing = map.get(name);
    if (existing && !options.override) {
      throw new Error(`Duplicate tool name "${name}" in scope ${scope === null ? "global" : scope} — use { override: true } to replace it`);
    }
    map.set(name, { tool, scope });
    const unregister = (): void => {
      const cur = map.get(name);
      if (cur && cur.tool === tool) {
        map.delete(name);
        if (map.size === 0) this.byScope.delete(scope);
      }
    };
    try {
      // SAFETY: cordis exposes `effect` as a mixed-in method on every Context.
      // If the caller fiber is already disposed `effect` throws, which we
      // swallow — the unregister handle the caller receives remains usable.
      (caller ?? this.ctx).effect(() => unregister);
    } catch {
      // fiber already disposed — unregister remains caller-driven
    }
    return unregister;
  }

  /**
   * Return the ToolSet visible from the caller's context.
   *
   * Global tools (scope === null) are always included; Life-scoped tools
   * only when the caller is the same Life that registered them.
   */
  // oxlint-disable-next-line anti-slop(no-known-value-widening) -- ToolMap is an intentionally open dictionary; tools are registered dynamically
  available(): ToolSet {
    const caller: Context | undefined = (this as unknown as Record<symbol, Context>)[CALLER];
    const myScope = caller ? scopeOf(caller) : null;
    const result: Record<string, AnyTool> = {};
    const global = this.byScope.get(null);
    if (global) {
      for (const [name, { tool }] of global) result[name] = tool;
    }
    if (myScope !== null) {
      const scoped = this.byScope.get(myScope);
      if (scoped) {
        for (const [name, { tool }] of scoped) result[name] = tool;
      }
    }
    return result;
  }
}

declare module "cordis" {
  interface Context {
    tools: ToolRegistry;
  }
}
