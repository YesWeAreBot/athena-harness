import type { BodyAdapter, Mode } from "@yesimbot/athena-runtime";
import type { ModePipeline } from "@yesimbot/athena-runtime";

export function createEchoMode(): Mode {
  return {
    name: "echo",
    setup: async () => ({ handle: async () => true }),
  };
}

export function createEchoPipeline(): ModePipeline {
  return {
    id: "echo",
    trigger: { kinds: ["event"] },
    context: {
      id: "echo-context",
      build: async () => ({ messages: [], system: "echo" }),
    },
    execution: {
      id: "echo-exec",
      kind: "structured-output",
      execute: async () => ({ kind: "text", output: "echo" }),
    },
    interpret: {
      id: "echo-interpret",
      interpret: async () => ({
        effects: [],
        output: "echo",
      }),
    },
    effects: [],
  };
}

export function createManualBodyAdapter(config: Record<string, unknown> = {}): BodyAdapter {
  return {
    id: typeof config.id === "string" ? config.id : "manual",
    name: typeof config.name === "string" ? config.name : "Manual Body",
    state: {},
    actuators: [
      {
        id: "echo",
        kind: "manual",
        act: async (action) => ({ status: "ok", output: action }),
      },
    ],
  };
}
