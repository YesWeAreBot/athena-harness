import { Service } from "cordis";
import type { Context } from "cordis";

import type { Session } from "@athena/session";

import type { PerceptEvent } from "../body/types.js";
import type { Life } from "../life/types.js";
import type { LifeMemory } from "../memory/index.js";
import type {
  ExecutionInput,
  InterpretedResult,
  ModePipeline,
} from "./types.js";

export interface ModePipelineRunInput {
  readonly percept?: PerceptEvent;
  readonly session: Session;
  readonly life: Life;
  readonly memory?: LifeMemory;
  readonly signal?: AbortSignal;
}

export class ModePipelineRunner {
  async run(pipeline: ModePipeline, input: ModePipelineRunInput): Promise<InterpretedResult> {
    const context = await pipeline.context.build(
      {
        percept: input.percept,
        session: input.session,
        life: input.life,
        memory: input.memory,
      },
      input.signal,
    );
    const executionInput: ExecutionInput = {
      context,
      percept: input.percept,
      session: input.session,
      life: input.life,
      signal: input.signal,
    };
    const execution = await pipeline.execution.execute(executionInput);
    const interpreted = await pipeline.interpret.interpret(execution, executionInput);
    for (const handler of pipeline.effects) {
      for (const action of interpreted.effects) {
        await handler.handle(action, executionInput);
      }
    }
    if (interpreted.continuation && pipeline.continuation) {
      await pipeline.continuation(interpreted.continuation, executionInput);
    }
    return interpreted;
  }
}

export class ModePipelineRegistry extends Service {
  static provide = "modePipelines";

  private readonly pipelines = new Map<string, ModePipeline>();
  private readonly runner = new ModePipelineRunner();

  constructor(ctx: Context) {
    super(ctx, "modePipelines");
    this.ctx.effect(() => () => {
      this.pipelines.clear();
    });
  }

  register(pipeline: ModePipeline): () => void {
    if (this.pipelines.has(pipeline.id)) {
      throw new Error(`ModePipeline already registered: ${pipeline.id}`);
    }
    this.pipelines.set(pipeline.id, pipeline);
    return this.ctx.effect(() => () => {
      if (this.pipelines.get(pipeline.id) === pipeline) this.pipelines.delete(pipeline.id);
    });
  }

  get(id: string): ModePipeline | undefined {
    return this.pipelines.get(id);
  }

  list(): readonly ModePipeline[] {
    return [...this.pipelines.values()];
  }

  async run(id: string, input: ModePipelineRunInput): Promise<InterpretedResult> {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) throw new Error(`ModePipeline not registered: ${id}`);
    return this.runner.run(pipeline, input);
  }
}

export const modePipelineRegistry = {
  apply(ctx: Context) {
    new ModePipelineRegistry(ctx);
  },
};

declare module "cordis" {
  interface Context {
    modePipelines: ModePipelineRegistry;
  }
}
