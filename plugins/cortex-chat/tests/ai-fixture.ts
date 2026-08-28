import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4Prompt, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider";

/**
 * Scripted AI SDK v4 language model.
 *
 * Each entry in `scripts` drives one `doStream` call, emitting the same stream
 * parts a real provider would so that `StepResult.content`, reasoning parts,
 * provider metadata, tool calls and tool results are all observable in the
 * runner. Every call's options — including the fully standardized prompt — are
 * recorded in `calls`.
 */
export type ModelScript =
  | { readonly kind: "text"; readonly text: string; readonly reasoning?: string }
  | { readonly kind: "tool"; readonly toolName: string; readonly input: unknown }
  | { readonly kind: "error"; readonly error: Error };

export interface ScriptedModel extends LanguageModelV4 {
  /** Options of every `doStream` call, in order. */
  readonly calls: readonly LanguageModelV4CallOptions[];
}

const MODEL_ID = "scripted-model";

const USAGE: LanguageModelV4Usage = {
  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 6, text: 6, reasoning: 0 },
  raw: {},
};

function textParts(script: { text: string; reasoning?: string }, step: number): LanguageModelV4StreamPart[] {
  const parts: LanguageModelV4StreamPart[] = [{ type: "stream-start", warnings: [] }];
  if (script.reasoning !== undefined) {
    parts.push({ type: "reasoning-start", id: `reasoning-${step}` });
    parts.push({
      type: "reasoning-delta",
      id: `reasoning-${step}`,
      delta: script.reasoning,
      providerMetadata: { scripted: { signature: `reasoning-signature-${step}` } },
    });
    parts.push({ type: "reasoning-end", id: `reasoning-${step}` });
  }
  parts.push({ type: "text-start", id: `text-${step}` });
  parts.push({ type: "text-delta", id: `text-${step}`, delta: script.text });
  parts.push({ type: "text-end", id: `text-${step}` });
  parts.push({
    type: "finish",
    usage: USAGE,
    finishReason: { unified: "stop", raw: "stop" },
    providerMetadata: { scripted: { step } },
  });
  return parts;
}

function toolParts(script: { toolName: string; input: unknown }, step: number): LanguageModelV4StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    {
      type: "tool-call",
      toolCallId: `call-${step}`,
      toolName: script.toolName,
      input: JSON.stringify(script.input),
      providerMetadata: { scripted: { step } },
    },
    {
      type: "finish",
      usage: USAGE,
      finishReason: { unified: "tool-calls", raw: "tool_calls" },
      providerMetadata: { scripted: { step } },
    },
  ];
}

function streamOf(parts: readonly LanguageModelV4StreamPart[]): ReadableStream<LanguageModelV4StreamPart> {
  return new ReadableStream<LanguageModelV4StreamPart>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

export function scriptedModel(scripts: readonly ModelScript[]): ScriptedModel {
  const calls: LanguageModelV4CallOptions[] = [];
  let step = 0;

  const nextScript = () => {
    const script = scripts[step];
    step += 1;
    if (!script) throw new Error(`scriptedModel exhausted: no script for call ${step}`);
    return { script, step };
  };

  return {
    specificationVersion: "v4",
    provider: "scripted",
    modelId: MODEL_ID,
    supportedUrls: {},
    calls,
    doGenerate: (options: LanguageModelV4CallOptions) => {
      calls.push(options);
      const { script, step: currentStep } = nextScript();
      if (script.kind === "error") return Promise.reject(script.error);
      if (script.kind === "text") {
        return Promise.resolve({
          content: [
            ...(script.reasoning === undefined ? [] : [{ type: "reasoning" as const, text: script.reasoning }]),
            { type: "text" as const, text: script.text },
          ],
          finishReason: { unified: "stop" as const, raw: "stop" },
          usage: USAGE,
          warnings: [],
        });
      }
      return Promise.resolve({
        content: [
          {
            type: "tool-call" as const,
            toolCallId: `call-${currentStep}`,
            toolName: script.toolName,
            input: JSON.stringify(script.input),
            providerMetadata: { scripted: { step: currentStep } },
          },
        ],
        finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
        usage: USAGE,
        warnings: [],
      });
    },
    doStream: (options: LanguageModelV4CallOptions) => {
      calls.push(options);
      const { script, step: currentStep } = nextScript();
      if (script.kind === "error") return Promise.reject(script.error);
      const parts = script.kind === "text" ? textParts(script, currentStep) : toolParts(script, currentStep);
      return Promise.resolve({ stream: streamOf(parts) });
    },
  };
}

/**
 * Scripted compaction model.
 *
 * Compaction runs through `generateText`, so this fake only implements
 * `doGenerate`. Every prompt it receives is flattened to text and recorded, and
 * `answer` may be an `Error` to reject the call instead of answering.
 */
export interface CompactModel extends LanguageModelV4 {
  /** One flattened prompt per `doGenerate` call, in order. */
  readonly prompts: readonly string[];
  /** Every recorded prompt joined together. */
  readonly prompt: string;
}

function promptText(prompt: LanguageModelV4Prompt): string {
  const lines: string[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      lines.push(message.content);
      continue;
    }
    if (message.role === "tool") continue;
    for (const part of message.content) {
      if (part.type === "text") lines.push(part.text);
    }
  }
  return lines.join("\n");
}

export function recordingCompactModel(answer: string | Error): CompactModel {
  const prompts: string[] = [];

  return {
    specificationVersion: "v4",
    provider: "scripted",
    modelId: "scripted-compact-model",
    supportedUrls: {},
    prompts,
    get prompt(): string {
      return prompts.join("\n");
    },
    doStream: () => Promise.reject(new Error("recordingCompactModel only supports doGenerate")),
    doGenerate: (options: LanguageModelV4CallOptions) => {
      prompts.push(promptText(options.prompt));
      if (answer instanceof Error) return Promise.reject(answer);
      return Promise.resolve({
        content: [{ type: "text" as const, text: answer }],
        finishReason: { unified: "stop" as const, raw: "stop" },
        usage: USAGE,
        warnings: [],
      });
    },
  };
}
