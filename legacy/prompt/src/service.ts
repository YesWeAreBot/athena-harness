import { createHash } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { AssembleResult, PromptSection } from "./types.js";

declare module "cordis" {
  interface Context {
    systemPrompt: SystemPrompt;
  }
}

export class SystemPrompt extends Service {
  static provide = "systemPrompt";

  private _globals = new Map<string, PromptSection>();
  private _scoped = new Map<symbol, Map<string, PromptSection>>();

  constructor(ctx: Context) {
    super(ctx, "systemPrompt");
  }

  /**
   * Register a section globally (key undefined) or scoped to an agent.
   * Scoped sections with the same name as a global section override the global.
   * Returns Cordis-effect cleanup.
   * Throws on duplicate name within the same scope.
   */
  add(section: PromptSection, key?: symbol): () => void {
    if (key !== undefined) {
      const layer = this._scoped.get(key) ?? new Map<string, PromptSection>();
      if (layer.has(section.name)) {
        throw new Error(`Prompt section already registered in scope: ${section.name}`);
      }
      layer.set(section.name, section);
      this._scoped.set(key, layer);
      return this.ctx.effect(() => () => {
        layer.delete(section.name);
      });
    }
    if (this._globals.has(section.name)) {
      throw new Error(`Prompt section already registered: ${section.name}`);
    }
    this._globals.set(section.name, section);
    return this.ctx.effect(() => () => {
      this._globals.delete(section.name);
    });
  }

  async assemble(key?: symbol, signal?: AbortSignal): Promise<AssembleResult> {
    // Merge: global first, then scoped overrides
    const merged = new Map<string, PromptSection>(this._globals);
    if (key !== undefined) {
      for (const [name, section] of this._scoped.get(key) ?? []) {
        merged.set(name, section);
      }
    }

    // Sort by order (ascending, stable)
    const sorted = [...merged.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    // Render each section
    const sections: Array<{ name: string; content: string }> = [];
    for (const s of sorted) {
      const content = await s.render(signal);
      sections.push({ name: s.name, content });
    }

    const system = sections.map((s) => s.content).join("\n\n");
    const rendered = createHash("sha256").update(system).digest("hex");

    return { system, rendered, sections };
  }
}
