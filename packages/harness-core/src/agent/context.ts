import type { Tool } from "ai";
import type { Context } from "cordis";

import type { Awaitable } from "../awaitable.js";
import type { UserProjector } from "../model-surface.js";

export interface AgentContext {
  readonly id: string;
  readonly scope: symbol;
  readonly tools: {
    register(name: string, tool: Tool): () => void;
  };
  readonly systemPrompt: {
    registerSection(name: string, content: string): () => void;
    registerContextProvider(name: string, render: () => Awaitable<string>): () => void;
  };
  readonly modelSurface: {
    registerUserProjector(type: string, projector: UserProjector): () => void;
  };
  plugin(plugin: unknown, config?: unknown): () => void;
  dispose(): Promise<void>;
}

export function createAgentContext(ctx: Context, id: string): AgentContext {
  const scope = Symbol(id);
  const disposers: Array<() => Awaitable<void>> = [];

  const register = (dispose: () => Awaitable<void>): (() => void) => {
    disposers.push(dispose);
    return dispose;
  };

  return {
    id,
    scope,
    tools: {
      register: (name, tool) => register(ctx.tools.register(name, tool, scope)),
    },
    systemPrompt: {
      registerSection: (name, content) => register(ctx.systemPrompt.registerSection(name, content, scope)),
      registerContextProvider: (name, render) => register(ctx.systemPrompt.registerContextProvider(name, render, scope)),
    },
    modelSurface: {
      registerUserProjector: (type, projector) => register(ctx.modelSurface.registerUserProjector(type, projector, scope)),
    },
    plugin: (plugin, config) => {
      const fiber = ctx.plugin(plugin as never, config as never);
      return register(() => fiber.dispose());
    },
    dispose: async () => {
      const current = disposers.splice(0).reverse();
      for (const dispose of current) {
        await dispose();
      }
    },
  };
}
