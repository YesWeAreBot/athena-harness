import { mkdir, open, readFile } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { join } from "node:path";

import type { Context } from "cordis";

import { Session } from "../session/index.js";
import type { SessionEvent, SessionHeader } from "../session/types.js";
import { parseSessionFile, serializeEvent, serializeHeader } from "./format.js";
import { Persistence, type PersistenceSessionBinding, type PreparedSession } from "./index.js";

export interface JsonlPersistenceConfig {
  root: string;
}

export class JsonlPersistence extends Persistence {
  private bindings = new Map<string, JsonlSessionBinding>();

  private prepared = new Set<string>();

  constructor(
    ctx: Context,
    private config: JsonlPersistenceConfig,
  ) {
    super(ctx);
    this.ctx.effect(() => async () => {
      await Promise.allSettled([...this.bindings.values()].map((binding) => binding.close()));
    });
  }

  async create(header: SessionHeader): Promise<PersistenceSessionBinding> {
    await mkdir(this.config.root, { recursive: true });
    const path = filePath(this.config.root, header.id);
    const handle = await open(path, "wx");
    try {
      await handle.writeFile(`${serializeHeader(header)}\n`, "utf8");
      await handle.sync();
    } catch (error) {
      await handle.close();
      throw error;
    }

    const binding = new JsonlSessionBinding(header.id, handle, () => {
      this.bindings.delete(header.id);
    });
    this.bindings.set(header.id, binding);
    return binding;
  }

  async open(id: string): Promise<PersistenceSessionBinding> {
    if (this.bindings.has(id) || this.prepared.has(id)) {
      throw new Error(`Session already active or prepared: ${id}`);
    }
    const path = filePath(this.config.root, id);
    const content = await readFile(path, "utf8");
    const parsed = parseSessionFile(content, id);
    Session.restore(parsed.header, parsed.events);

    const handle = await open(path, "a");
    const binding = new JsonlSessionBinding(
      id,
      handle,
      () => {
        this.bindings.delete(id);
      },
      parsed.events.length,
    );
    this.bindings.set(id, binding);
    return binding;
  }

  async prepare(id: string): Promise<PreparedSession> {
    if (this.bindings.has(id) || this.prepared.has(id)) {
      throw new Error(`Session already active or prepared: ${id}`);
    }
    const path = filePath(this.config.root, id);
    const content = await readFile(path, "utf8");
    const parsed = parseSessionFile(content, id);
    const repaired = repairOpenTurn(parsed.events);
    if (repaired.length) {
      const handle = await open(path, "a");
      try {
        await handle.writeFile(`${repaired.map(serializeEvent).join("\n")}\n`, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
    }
    const events = [...parsed.events, ...repaired];
    const session = Session.restore(parsed.header, events);

    this.prepared.add(id);
    return {
      header: parsed.header,
      events: session.snapshotEvents,
      close: async () => {
        this.prepared.delete(id);
      },
    };
  }
}

export const jsonlPersistence = {
  apply(ctx: Context, config: JsonlPersistenceConfig) {
    new JsonlPersistence(ctx, config);
  },
};

function filePath(root: string, id: string): string {
  return join(root, `${encodeURIComponent(id)}.jsonl`);
}

function repairOpenTurn(events: readonly SessionEvent[]): SessionEvent[] {
  let open = false;
  let openStep = false;
  let turn = 0;
  let step = 0;
  const pendingCalls = new Map<string, string>();
  const completedCalls = new Set<string>();

  for (const event of events) {
    const data = event.data as {
      turn?: number;
      step?: number;
      call?: { toolCallId: string; toolName: string };
      message?: {
        content?: Array<{ type: string; toolCallId: string }>;
      };
    };
    if (event.type === "turn/start") {
      open = true;
      openStep = false;
      turn = data.turn ?? 0;
      step = 0;
      pendingCalls.clear();
      completedCalls.clear();
    } else if (event.type === "turn/end") {
      open = false;
    } else if (event.type === "step/start") {
      openStep = true;
      step = data.step ?? step;
    } else if (event.type === "step/end") {
      openStep = false;
    } else if (event.type === "tool/call" && data.call) {
      pendingCalls.set(data.call.toolCallId, data.call.toolName);
    } else if (event.type === "tool/result" && data.message?.content) {
      for (const part of data.message.content) {
        if (part.type === "tool-result") completedCalls.add(part.toolCallId);
      }
    }
  }

  if (!open) return [];

  const repaired: SessionEvent[] = [];
  let seq = events.at(-1)?.seq ?? 0;
  for (const [callId, toolName] of pendingCalls) {
    if (completedCalls.has(callId)) continue;
    seq++;
    repaired.push({
      type: "tool/result",
      seq,
      time: Date.now(),
      data: {
        turn,
        step,
        status: "interrupted",
        message: {
          role: "tool",
          content: [
            {
              type: "tool-result",
              toolCallId: callId,
              toolName,
              output: {
                type: "error-text",
                value: "interrupted: unknown outcome",
              },
            },
          ],
        },
      },
      surfaceOp: "append",
      sourceEventSeqs: [seq],
    });
  }

  if (openStep) {
    seq++;
    repaired.push({
      type: "step/end",
      seq,
      time: Date.now(),
      data: { turn, step },
    });
  }

  seq++;
  repaired.push({
    type: "turn/end",
    seq,
    time: Date.now(),
    data: {
      turn,
      reason: { kind: "interrupted" },
    },
  });

  return repaired;
}

class JsonlSessionBinding implements PersistenceSessionBinding {
  private count: number;

  private tail: Promise<void> = Promise.resolve();

  private closed = false;

  constructor(
    readonly id: string,
    private handle: FileHandle,
    private onClose: () => void,
    initialCount = 0,
  ) {
    this.count = initialCount;
  }

  append(events: readonly SessionEvent[]): void {
    if (this.closed) throw new Error(`Session binding is closed: ${this.id}`);
    if (!events.length) return;

    const expected = this.count + 1;
    if (events[0]!.seq !== expected) {
      throw new Error(`Session ${this.id} append sequence starts at ${events[0]!.seq}, expected ${expected}`);
    }
    events.forEach((event, index) => {
      if (event.seq !== expected + index) {
        throw new Error(`Session ${this.id} has a sequence gap in append batch`);
      }
    });

    this.count += events.length;
    const payload = `${events.map(serializeEvent).join("\n")}\n`;
    this.tail = this.tail.then(() => this.handle.writeFile(payload, "utf8"));
  }

  async flush(): Promise<void> {
    await this.tail;
    await this.handle.sync();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    try {
      await this.flush();
    } finally {
      await this.handle.close();
      this.onClose();
    }
  }
}
