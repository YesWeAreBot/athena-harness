import { jsonSchema } from "@athena-ai/core";
import type { ModelMessage, Tool, ToolSet } from "@athena-ai/core";
// `@cordisjs/element` arrives through protocol-im, which re-exports it: this
// package declares protocol-im, not the element library.
import { parse } from "@athena-ai/protocol-im";
import type { Element, Fragment, IMBody } from "@athena-ai/protocol-im";
import type { Context } from "cordis";

import type { SceneAddress } from "./scene.js";

// ─── Shared types ────────────────────────────────────────────────────────────

export interface PacingConfig {
  readonly charactersPerSecond: number;
  readonly maxTotalDelayMs: number;
}

export interface SendMessageInput {
  readonly messages: readonly string[];
  readonly target?: SceneAddress;
  readonly mode?: "element" | "raw";
  readonly continue?: boolean;
  readonly inner_thought?: string;
}

export type SendMessageOutput =
  | { readonly ok: true; readonly messageIds: readonly string[]; readonly count: number }
  | {
      readonly ok: false;
      readonly sent: readonly string[];
      readonly failedAt: number;
      readonly error: { readonly name: string; readonly message: string; readonly code?: string };
    };

export interface SwitchFocusInput {
  readonly target: SceneAddress;
  readonly reason: string;
}

export interface SwitchFocusOutput {
  readonly ok: true;
  readonly focus: SceneAddress;
}

export interface PeekChannelInput {
  readonly target: SceneAddress;
  readonly limit?: number;
}

export interface PeekChannelOutput {
  readonly scene: SceneAddress;
  readonly messages: ReadonlyArray<{
    readonly userId: string;
    readonly content: string;
    readonly timestamp: number;
  }>;
}

export interface WaitInput {
  readonly reason: string;
}

export type WaitOutput = { readonly ok: true };

export interface CoreToolRuntime {
  logicalFocus(): SceneAddress | null;
  switchFocus(target: SceneAddress, reason: string): Promise<SwitchFocusOutput>;
  peekChannel(target: SceneAddress, limit: number): Promise<PeekChannelOutput>;
  appendWorkspaceDelta(messages: readonly ModelMessage[]): void;
}

// ─── Pacing & sleep ──────────────────────────────────────────────────────────

function elementTextLength(el: Element): number {
  const raw = (el.attrs as Record<string, unknown>).content;
  const content = typeof raw === "string" ? raw.length : 0;
  return content + el.children.reduce((sum, child) => sum + elementTextLength(child), 0);
}

function messageLength(content: string, mode: "element" | "raw"): number {
  if (mode === "raw") return content.length;
  try {
    const els = parse(content) as unknown as Element[];
    if (!els || els.length === 0) return content.length;
    const len = els.reduce((sum, el) => sum + elementTextLength(el), 0);
    return len > 0 ? len : content.length;
  } catch {
    return content.length;
  }
}

function pacedDelay(chars: number, pacing: PacingConfig, elapsed: number): number {
  const raw = Math.min(Math.max(250, Math.ceil((chars / pacing.charactersPerSecond) * 1000)), 10_000);
  return elapsed + raw >= pacing.maxTotalDelayMs ? 250 : Math.round(raw);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) {
    const reason: unknown = (signal as unknown as { reason?: unknown }).reason ?? new DOMException("Aborted", "AbortError");
    return Promise.reject(reason);
  }
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      cleanup();
      const reason: unknown = (signal as unknown as { reason?: unknown }).reason ?? new DOMException("Aborted", "AbortError");
      reject(reason);
    };
    const cleanup = () => {
      signal?.removeEventListener("abort", onAbort);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── send_message ────────────────────────────────────────────────────────────

export function createSendMessageTool(opts: {
  ctx: Context;
  runtime: CoreToolRuntime;
  pacing?: PacingConfig;
  innerThought?: boolean;
}): Tool<SendMessageInput, SendMessageOutput, never> {
  const { ctx, runtime } = opts;
  const pacing: PacingConfig = opts.pacing ?? { charactersPerSecond: 8, maxTotalDelayMs: 60_000 };
  const innerThought: boolean = opts.innerThought ?? true;

  return {
    description: sendMessageDescription(innerThought),
    inputSchema: jsonSchema<SendMessageInput>({
      type: "object",
      properties: {
        ...(innerThought
          ? {
              inner_thought: {
                type: "string",
                description: "本次发送前的内心独白；只保留在你自己的历史里，不会发送给任何人",
              },
            }
          : {}),
        target: {
          type: "object",
          properties: {
            bodySid: { type: "string", minLength: 1 },
            channelId: { type: "string", minLength: 1 },
          },
          required: ["bodySid", "channelId"],
          description: "目标场景；留空则发往 logicalFocus",
        },
        mode: {
          type: "string",
          enum: ["element", "raw"],
          description: "element（默认）解析消息元素；raw 原样发送纯文本",
        },
        messages: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
          description: "要发送的消息，每一项作为一条独立消息按顺序发出",
        },
        continue: {
          type: "boolean",
          description: "true 时发送后继续生成下一步，可以再调用工具或再次发送消息",
        },
      },
      required: ["messages"],
    }),
    execute: async (input: SendMessageInput, toolOptions) => {
      // The declared input type is what the schema asks for, not what a model
      // actually sends, so both shape checks below are runtime facts.
      const msgs: readonly string[] = Array.isArray(input.messages) ? input.messages : [];
      if (msgs.length === 0) {
        return { ok: false, sent: [], failedAt: 0, error: { name: "InvalidInput", message: "messages is empty" } } as SendMessageOutput;
      }
      // oxlint-disable-next-line anti-slop(no-runtime-typeof) -- I/O boundary: LLM tool input is untyped at runtime
      if (msgs.some((m) => typeof m !== "string" || m.length === 0)) {
        return {
          ok: false,
          sent: [],
          failedAt: 0,
          error: { name: "InvalidInput", message: "messages must be non-empty strings" },
        } as SendMessageOutput;
      }
      // The declared type says `"element" | "raw"`, but a model can send anything.
      const modeVal: string | undefined = input.mode;
      if (modeVal !== undefined && modeVal !== "element" && modeVal !== "raw") {
        return {
          ok: false,
          sent: [],
          failedAt: 0,
          error: { name: "InvalidInput", message: `mode must be "element" or "raw"` },
        } as SendMessageOutput;
      }
      const mode: "element" | "raw" = modeVal === "raw" ? "raw" : "element";

      const resolvedTarget: SceneAddress | null = input.target ?? runtime.logicalFocus();

      if (!resolvedTarget) {
        return {
          ok: false,
          sent: [],
          failedAt: 0,
          error: { name: "NoFocusError", message: "No focus Scene is available" },
        } as SendMessageOutput;
      }

      const { bodySid, channelId } = resolvedTarget;

      // Resolve body exactly once
      const body = (ctx.nerve.get as (sid: string) => unknown)(bodySid) as (IMBody & { supports?: (name: string) => boolean }) | undefined;

      if (!body || typeof body.sendMessage !== "function") {
        return {
          ok: false,
          sent: [],
          failedAt: 0,
          error: {
            name: "BodyNotFound",
            message: `Body not found or unsupported: ${bodySid} channel ${channelId}`,
          },
        } as SendMessageOutput;
      }

      // Validate IM body supports sendMessage if supports() is available
      if (typeof body.supports === "function" && !body.supports("message.send") && !body.supports("message.create")) {
        // Still allow if supports reports missing — diagnostic
        return {
          ok: false,
          sent: [],
          failedAt: 0,
          error: {
            name: "UnsupportedBody",
            message: `Body ${bodySid} does not support sendMessage for ${channelId}`,
          },
        } as SendMessageOutput;
      }

      const signal = (toolOptions as { abortSignal?: AbortSignal } | undefined)?.abortSignal;
      const sent: string[] = [];
      let elapsed = 0;

      for (let index = 0; index < msgs.length; index++) {
        const message = msgs[index]!;
        // pacing delay before every message except the first send
        if (sent.length > 0) {
          const len = messageLength(message, mode);
          const delay = pacedDelay(len, pacing, elapsed);
          const started = Date.now();
          try {
            await sleep(delay, signal);
          } catch (error: unknown) {
            const r = error as { name?: string; message?: string };
            return {
              ok: false,
              sent: [...sent],
              failedAt: index,
              error: { name: r?.name ?? "AbortError", message: r?.message ?? String(error ?? "send_message aborted") },
            } as SendMessageOutput;
          }
          elapsed += Math.max(delay, Date.now() - started);
          if (signal?.aborted) {
            const reason: unknown = (signal as unknown as { reason?: unknown }).reason ?? new DOMException("Aborted", "AbortError");
            const r = reason as { name?: string; message?: string };
            return {
              ok: false,
              sent: [...sent],
              failedAt: index,
              error: { name: r?.name ?? "AbortError", message: r?.message ?? String(reason) },
            } as SendMessageOutput;
          }
        } else if (signal?.aborted) {
          const reason: unknown = (signal as unknown as { reason?: unknown }).reason ?? new DOMException("Aborted", "AbortError");
          const r = reason as { name?: string; message?: string };
          return {
            ok: false,
            sent: [...sent],
            failedAt: index,
            error: { name: r?.name ?? "AbortError", message: r?.message ?? String(reason) },
          } as SendMessageOutput;
        }

        try {
          const fragment: Fragment = mode === "raw" ? message : (parse(message) as unknown as Fragment);
          const ids = await body.sendMessage(channelId, fragment as Fragment);
          const arr: string[] = Array.isArray(ids) ? (ids as string[]).map(String) : [String(ids)];
          // Never return mock ids — if adapter returned mock-like string but that came from real body, keep it; the only forbidden path is the old mock fallback which we removed.
          sent.push(...arr);
        } catch (error: unknown) {
          if (signal?.aborted) {
            const reason: unknown = (signal as unknown as { reason?: unknown }).reason ?? error;
            const r = reason as { name?: string; message?: string };
            return {
              ok: false,
              sent: [...sent],
              failedAt: index,
              error: { name: r?.name ?? "AbortError", message: r?.message ?? String(reason) },
            } as SendMessageOutput;
          }
          const e = error as { name?: string; message?: string; code?: string };
          const name = e?.name ?? (error instanceof Error ? error.name : "Error");
          const msg = e?.message ?? (error instanceof Error ? error.message : String(error));
          const code = (e as { code?: string })?.code;
          return {
            ok: false,
            sent: [...sent],
            failedAt: index,
            error: { name, message: msg, ...(code ? { code } : {}) },
          } as SendMessageOutput;
        }
      }

      return { ok: true, messageIds: [...sent], count: msgs.length } as SendMessageOutput;
    },
  } as unknown as Tool<SendMessageInput, SendMessageOutput, never>;
}

// ─── wait ────────────────────────────────────────────────────────────────────

export function createWaitTool(): Tool<WaitInput, WaitOutput, never> {
  return {
    description:
      "显式沉默。当前场景不需要你发言、或你选择保持沉默时调用。本工具会立即结束本轮，不发送任何消息。reason 说明你为什么决定不回复（仅留在你自己的记录中，不会发送给任何人）。",
    inputSchema: jsonSchema<WaitInput>({
      type: "object",
      properties: { reason: { type: "string", description: "为什么选择沉默" } },
      required: ["reason"],
    }),
    execute: async () => ({ ok: true }),
  } as unknown as Tool<WaitInput, WaitOutput, never>;
}

// ─── switch_focus ────────────────────────────────────────────────────────────

export function createSwitchFocusTool(runtime: CoreToolRuntime): Tool<SwitchFocusInput, SwitchFocusOutput, never> {
  return {
    description:
      "切换你的注意力焦点到另一个频道。切换后当前 turn 继续，你会看到新频道的上下文，可以立即处理那边的事务。reason 说明为什么要切换（用于后续记忆）。注意：切换会触发检查点重建，当前工作区的细枝末节会被压缩进记忆。",
    inputSchema: jsonSchema<SwitchFocusInput>({
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            bodySid: { type: "string", minLength: 1 },
            channelId: { type: "string", minLength: 1 },
          },
          required: ["bodySid", "channelId"],
          description: "要切换到的场景",
        },
        reason: { type: "string", description: "切换原因" },
      },
      required: ["target", "reason"],
    }),
    execute: async (input) => {
      const out = await runtime.switchFocus(input.target, input.reason);
      return out;
    },
  } as unknown as Tool<SwitchFocusInput, SwitchFocusOutput, never>;
}

// ─── peek_channel ────────────────────────────────────────────────────────────

export function createPeekChannelTool(runtime: CoreToolRuntime): Tool<PeekChannelInput, PeekChannelOutput, never> {
  return {
    description:
      "旁路读取：查看指定频道的最近消息，不改变你的 focus。适用于收到 awareness 通知后想多看几条再决定，或快速了解某个频道的聊天内容。返回最近的 N 条消息摘要。",
    inputSchema: jsonSchema<PeekChannelInput>({
      type: "object",
      properties: {
        target: {
          type: "object",
          properties: {
            bodySid: { type: "string", minLength: 1 },
            channelId: { type: "string", minLength: 1 },
          },
          required: ["bodySid", "channelId"],
          description: "目标频道",
        },
        limit: {
          type: "number",
          minimum: 1,
          maximum: 20,
          description: "要读取的最近消息数，默认 10",
        },
      },
      required: ["target"],
    }),
    execute: async (input) => {
      const limit = input.limit ?? 10;
      const out = await runtime.peekChannel(input.target, limit);
      return out;
    },
  } as unknown as Tool<PeekChannelInput, PeekChannelOutput, never>;
}

// ─── Core assembly ───────────────────────────────────────────────────────────

export function createCoreTools(ctx: Context, runtime: CoreToolRuntime, pacing?: PacingConfig, innerThought?: boolean): ToolSet {
  const core: Record<string, Tool<unknown, unknown, never>> = {
    send_message: createSendMessageTool({ ctx, runtime, pacing, innerThought }) as unknown as Tool<unknown, unknown, never>,
    wait: createWaitTool() as unknown as Tool<unknown, unknown, never>,
    switch_focus: createSwitchFocusTool(runtime) as unknown as Tool<unknown, unknown, never>,
    peek_channel: createPeekChannelTool(runtime) as unknown as Tool<unknown, unknown, never>,
  };
  return core as unknown as ToolSet;
}

/**
 * Merge core tools with registered tools. Throws if a registered tool name
 * conflicts with a core tool instead of silently overriding.
 */
export function assembleTools(ctx: Context, runtime: CoreToolRuntime, pacing?: PacingConfig, innerThought?: boolean): ToolSet {
  const core = createCoreTools(ctx, runtime, pacing, innerThought) as Record<string, unknown>;
  const ext = (ctx.tools.available() as Record<string, unknown>) ?? {};
  for (const name of Object.keys(ext)) {
    if (name in core) {
      throw new Error(`tool name conflict: "${name}" is already a core tool`);
    }
  }
  return { ...(core as ToolSet), ...(ext as ToolSet) };
}

// ─── description ─────────────────────────────────────────────────────────────

function sendMessageDescription(innerThought: boolean): string {
  return `向频道发送消息。这是消息到达平台的唯一途径——你的文本输出不会被发送，只有本工具发出的内容会被别人看到。

调用后生成一条真正展示给用户的回复。你可以针对某个用户回复，也可以对所有用户回复。发言必须通过send_message工具，不然用户无法看见，这是你与用户交流的唯一途径。。

# 参数

## messages
要发送的消息列表，每一项作为一条独立消息按顺序发出。
让分条跟随对话节奏：快速反应和深思熟虑的解释各有恰当的时刻，不要固守习惯性的条数或长度。读者逐条看到消息，每次分条都会让半截回复单独停留片刻，只在不伤害这种「半截状态」的地方分条。事实、指令、代码、链接、结构化内容、修正，以及任何后果重大的内容，都应保持在同一条消息内。
不要用空行分段。平台不会把空行渲染成视觉分隔，它只是一个被吞掉的空白，让消息看起来格式奇怪。需要分开就分成多条。

## target
目标场景（bodySid + channelId）。留空发往当前 focus（logicalFocus）。

## mode
- element（默认）：内容按下面的消息元素语法解析，<img> 与 <file> 的资源 URI 会被解析成真实内容。
- raw：内容作为字面量原样发送，不解析任何元素。尖括号、& 和引号都不需要转义，你写下的每个字符原样到达接收方。发送代码、日志、命令行输出、含大量特殊字符的文本，或需要精确控制每个字符时用它。

## continue
默认 false。设为 true 时，发送后继续生成下一步，可以再调用工具或再次发送消息。需要「先回应再去做事」或「分几次发送并在中间查资料」时用它。
${
  innerThought
    ? `
## inner_thought
本次发送前的内心活动——感受当前场景的氛围、形成对正在发生的事的判断、规划接下来的行动，或反思之前的选择。
它不会到达平台，任何人都看不到，但会保留在你自己的历史里，之后你能看到当时想了什么。不要把其中的话当作已经说出口；需要让对方知道某个判断，必须另外写进 messages。没有固定长度或频率要求，不需要每次都写。
`
    : ""
}
# 返回值
成功返回 {ok:true, messageIds, count}。
失败返回 {ok:false, error, sent, failedAt}：sent 是已经成功发出的消息 ID，failedAt 是出错的 messages 下标。发送遇错会立即停止，failedAt 及其之后的消息都没有发出。必须检查 ok，不要假设发送成功。

# 消息元素（仅 mode=element）
消息元素的语法与 HTML 类似，形如 <名称 属性="值"/>。你观察到的消息由元素组成，你发出的消息使用同一套元素：普通文本直接写，结构元素直接放在文本里。
元素名只能由小写字母、数字和连字符组成，且以字母开头。不符合规则的标签形式会被当作普通文本——但如果你的文本恰好长得像合法元素名，它就会被错误解析。这就是为什么转义很重要。

## 常用元素
<at id="用户ID"/>：提及某人。id 填用户 ID，不是昵称。
<at type="all"/>：提及全体成员。<at type="here"/>：提及在线成员。
<quote id="消息ID"/>：引用某条消息。id 取自该消息观察头的 id。
<img src="…"/>：图片。src 支持频道资源 URI。
<file src="…"/>：文件。src 支持频道资源 URI。
<audio src="…"/>：语音。src 只能是平台可直接访问的地址。
<video src="…"/>：视频。src 只能是平台可直接访问的地址。
<text>…</text>：逐字交付的纯文本块。其中的内容不会被解析成元素，所有字符原样到达接收方。用它包裹含尖括号的代码、标签示例、泛型签名等片段。整条消息都是这类内容时，直接用 mode=raw 更省事。

## 转义（关键）
< 和 > 如果没有转义，系统会尝试把它们之间的内容解析为元素。如果解析成功，你原本想输出的文字就会消失——这不是显示异常，而是内容被永久吞掉。
例如：你想说「当 a<b 且 c>d 时」，但 <b 且 c> 看起来像一个元素，会被解析掉，接收方看到的是「当 a d 时」。
规则：文本中出现的 <、>、&、" 如果不是用来构成元素标签，必须转义。
| 字符 | 转义 | 何时需要 |
|:---:|:---:|:---|
| < | &lt; | 文本中所有非元素用途的 < |
| > | &gt; | 文本中所有非元素用途的 > |
| & | &amp; | 文本中的 &（否则会被当作转义序列开头） |
| " | &quot; | 元素属性值内的引号 |

## 示例
普通对话，不需要特殊处理：
messages: ["今天天气不错"]

分多条发送：
messages: ["先说结论", "具体原因是这样的……"]

提及某人并引用消息：
messages: ["<quote id=\\"msg_12345\\"/><at id=\\"114514\\"/> 你说的这个我有不同看法"]

文本中包含尖括号：
messages: ["泛型写法是 Array&lt;string&gt;，不是 Array(string)"]
→ 接收方看到：泛型写法是 Array<string>，不是 Array(string)

发送代码——用 mode=raw 最直接：
mode: "raw", messages: ["function compare<T>(a: T, b: T) {\\n  return a < b;\\n}"]

错误示范——忘记转义：
messages: ["当 x<10 且 y>5 时执行"]
❌ 系统尝试解析 <10 且 y>，内容丢失。改用转义或 mode=raw。

## 资源与不支持的格式
只有 <img> 和 <file> 的 src 支持频道资源 URI（可用方案见 read 工具说明），发送前会被解析成真实内容；<audio> 和 <video> 的 src 不会被解析。资源解析失败时该元素会被整条丢掉，消息其余部分照常发出——引用资源前先确认它存在。
平台不支持的修饰元素（加粗、斜体、Markdown 格式等）会被去掉标签、保留其中的文字。不要依赖排版来表达结构或强调。`;
}
