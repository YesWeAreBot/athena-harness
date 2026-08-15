import { randomUUID } from "node:crypto";
import type { AppendOptions, SessionEvent, SessionEventMap, SessionHeader, SessionSnapshot } from "./types.js";
import { Surface } from "./surface.js";
import {
  ToolCallMissingError,
  TurnClosedError,
  TurnNotOpenError,
} from "./errors.js";

export class Session {
  readonly header: SessionHeader;
  readonly surface: Surface;

  private _events: SessionEvent[] = [];
  // seq → event for O(1) lookup
  private _bySeq = new Map<number, SessionEvent>();

  constructor(header?: Partial<SessionHeader>) {
    this.header = Object.freeze({
      id: header?.id ?? `session_${randomUUID()}`,
      createdAt: header?.createdAt ?? Date.now(),
    });
    this.surface = new Surface();
  }

  get id(): string { return this.header.id; }
  get events(): readonly SessionEvent[] { return this._events; }

  append<K extends keyof SessionEventMap>(
    type: K,
    data: SessionEventMap[K],
    opts?: AppendOptions,
  ): SessionEvent<SessionEventMap[K]>;
  append<T>(type: string, data: T, opts?: AppendOptions): SessionEvent<T>;
  append(type: string, data: unknown, opts: AppendOptions = {}): SessionEvent {
    this._checkInvariants(type, data, opts);

    const seq = this._events.length + 1;
    const event: SessionEvent = Object.freeze({
      type,
      seq,
      time: Date.now(),
      data: Object.freeze(data as object) as unknown,
      ...(opts.surfaceOp !== undefined ? { surfaceOp: opts.surfaceOp } : {}),
      ...(opts.sourceEventSeqs !== undefined
        ? { sourceEventSeqs: Object.freeze([...opts.sourceEventSeqs]) }
        : {}),
    });

    this._events.push(event);
    this._bySeq.set(seq, event);

    // Update Surface
    if (opts.surfaceOp === "append") {
      this.surface.appendNode(seq);
    } else if (opts.surfaceOp) {
      const { start, end } = opts.surfaceOp.replace;
      this.surface.replaceNodes(seq, start, end);
    }

    return event;
  }

  getEvent(seq: number): SessionEvent | undefined {
    return this._bySeq.get(seq);
  }

  snapshot(): SessionSnapshot {
    return { header: { ...this.header }, events: [...this._events] };
  }

  // ── private ────────────────────────────────────────────────────────────────

  private _checkInvariants(type: string, data: unknown, opts: AppendOptions): void {
    const STEP_PREFIXED = type.startsWith("step/") || type.startsWith("tool/");
    const d = data as Record<string, unknown>;

    if (STEP_PREFIXED) {
      const turn = d["turn"] as number | undefined;
      if (turn !== undefined) {
        if (this._isTurnClosed(turn)) throw new TurnClosedError(turn, type);
        if (!this._isTurnOpen(turn)) throw new TurnNotOpenError(turn, type);
      }
    }

    if (type === "tool/result") {
      const turn  = d["turn"]  as number;
      const step  = d["step"]  as number;
      const callId = (d["result"] as Record<string, unknown> | undefined)?.["toolCallId"] as string | undefined;
      if (callId && !this._hasToolCall(turn, step, callId)) {
        throw new ToolCallMissingError(turn, step, callId);
      }
    }

    if (type.startsWith("turn/") || STEP_PREFIXED) {
      const turn = d["turn"] as number | undefined;
      if (turn !== undefined && type !== "turn/start") {
        if (this._isTurnClosed(turn)) throw new TurnClosedError(turn, type);
      }
    }

    if (opts.surfaceOp && opts.surfaceOp !== "append") {
      // range validation happens inside surface.replaceNodes — let it throw
    }
  }

  private _isTurnOpen(turn: number): boolean {
    return this._events.some((e) => e.type === "turn/start" && (e.data as Record<string,unknown>)["turn"] === turn) &&
           !this._isTurnClosed(turn);
  }

  private _isTurnClosed(turn: number): boolean {
    return this._events.some((e) => e.type === "turn/end" && (e.data as Record<string,unknown>)["turn"] === turn);
  }

  private _hasToolCall(turn: number, step: number, toolCallId: string): boolean {
    return this._events.some((e) => {
      if (e.type !== "tool/call") return false;
      const d = e.data as Record<string, unknown>;
      const call = d["call"] as Record<string, unknown> | undefined;
      return d["turn"] === turn && d["step"] === step && call?.["toolCallId"] === toolCallId;
    });
  }
}

/** Restore from a snapshot without re-running invariants (spec C3: lenient). */
export function restoreSession(header: SessionHeader, events: readonly SessionEvent[]): Session {
  const session = new Session(header);
  const internal = session as unknown as {
    _events: SessionEvent[];
    _bySeq: Map<number, SessionEvent>;
  };
  for (const ev of events) {
    internal._events.push(ev);
    internal._bySeq.set(ev.seq, ev);
    if (ev.surfaceOp === "append") {
      session.surface.appendNode(ev.seq);
    } else if (ev.surfaceOp && typeof ev.surfaceOp !== "string") {
      const { start, end } = ev.surfaceOp.replace;
      // lenient: if range is invalid after crash, skip surface update
      try {
        session.surface.replaceNodes(ev.seq, start, end);
      } catch (err) {
        // TODO: log divergence for telemetry — surface state differs from event log
        console.warn(`restoreSession: skipped invalid replace [${start}, ${end}) for seq=${ev.seq}`, err);
      }
    }
  }
  return session;
}
