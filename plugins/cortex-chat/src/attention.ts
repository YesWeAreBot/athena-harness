import type { IMMessageEvent } from "@athena-ai/protocol-im";

import type { MessageStore } from "./message-store.js";
import { shouldTrigger } from "./trigger.js";
import type { WsMessage } from "./workspace-store.js";
import { createWsMessage } from "./workspace-store.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sceneId(platform: string, channelId: string): string {
  return `${platform}:${channelId}`;
}

function truncatePlatformText(text: string, n = 100): string {
  if (text.length <= n) return text;
  return `${text.slice(0, n)}…`;
}

// ─── AttentionState ──────────────────────────────────────────────────────────

export interface AttentionSnapshot {
  focusSceneId: string | null;
  focusPlatform: string | null;
  focusChannelId: string | null;
}

export type RouteResult =
  | { kind: "trigger"; awareness: false; messages: WsMessage[] }
  | { kind: "background"; awareness: false; messages: WsMessage[] }
  | { kind: "awareness"; awareness: true; messages: WsMessage[] }
  | { kind: "ignore"; awareness: false };

export interface AttentionOptions {
  store: MessageStore;
  initialFocus?: string | null;
}

export class Attention {
  private focusSceneId: string | null;
  private focusPlatform: string | null = null;
  private focusChannelId: string | null = null;
  private pendingAwareness: IMMessageEvent[] = [];

  constructor(private readonly opts: AttentionOptions) {
    this.focusSceneId = opts.initialFocus ?? null;
    if (this.focusSceneId) {
      const at = this.focusSceneId.indexOf(":");
      if (at !== -1) {
        this.focusPlatform = this.focusSceneId.slice(0, at);
        this.focusChannelId = this.focusSceneId.slice(at + 1);
      }
    }
  }

  snapshot(): AttentionSnapshot {
    return {
      focusSceneId: this.focusSceneId,
      focusPlatform: this.focusPlatform,
      focusChannelId: this.focusChannelId,
    };
  }

  setFocus(platform: string, channelId: string): void {
    this.focusSceneId = sceneId(platform, channelId);
    this.focusPlatform = platform;
    this.focusChannelId = channelId;
  }

  /** Direct switch_focus tool entry point. */
  async switchFocus(platform: string, channelId: string): Promise<void> {
    this.setFocus(platform, channelId);
  }

  /** Format an awareness delta for injection into workspace. */
  async formatAwarenessDelta(event: IMMessageEvent): Promise<string> {
    const preview = await this.opts.store.getByChannel(event.platform, event.channelId, { limit: 1 });
    const latest = preview[0];
    const lines: string[] = [];
    lines.push(`[awareness · #${event.channelId} · ${event.platform}]`);
    lines.push(`  @${event.userId}: ${truncatePlatformText(event.content ?? "")}`);
    lines.push("  ---");
    if (latest) {
      lines.push(`  最近 1 条: ${truncatePlatformText(latest.content)}`);
    } else {
      lines.push("  (无历史预览)");
    }
    return lines.join("\n");
  }

  /**
   * Route an incoming IMMessageEvent.
   *
   * Returns whether the main mind should fire a turn, and if so which
   * WsMessages to append to workspace before the turn.
   *
   * Side-effect: on the first trigger when focus is null, adopts that
   * channel as focus (cold-start).
   */
  async route(event: IMMessageEvent): Promise<RouteResult> {
    const trigger = shouldTrigger(event);
    const sid = sceneId(event.platform, event.channelId);
    const isFocus = this.focusSceneId !== null && this.focusSceneId === sid;

    // Cold-start: first trigger wins focus
    if (trigger && this.focusSceneId === null) {
      this.setFocus(event.platform, event.channelId);
      const ws = createWsMessage({ role: "user", content: event.content ?? "" } as never);
      return { kind: "trigger", awareness: false, messages: [ws] };
    }

    if (isFocus) {
      if (trigger) {
        const ws = createWsMessage({ role: "user", content: event.content ?? "" } as never);
        return { kind: "trigger", awareness: false, messages: [ws] };
      }
      const ws = createWsMessage({ role: "user", content: `[bg] ${event.content ?? ""}` } as never);
      return { kind: "background", awareness: false, messages: [ws] };
    }

    // Non-focus
    if (trigger) {
      this.pendingAwareness.push(event);
      const text = await this.formatAwarenessDelta(event);
      const ws = createWsMessage({ role: "user", content: text } as never);
      return { kind: "awareness", awareness: true, messages: [ws] };
    }

    // Non-focus, non-trigger → message-store only. Callers still call store().
    return { kind: "ignore", awareness: false };
  }

  /** Awareness payload rendered inside the Frame's <awareness> section. */
  awarenessFrameLines(): string[] {
    if (this.pendingAwareness.length === 0) return ["(无待处理事项)"];
    const byScene = new Map<string, IMMessageEvent[]>();
    for (const ev of this.pendingAwareness) {
      const id = sceneId(ev.platform, ev.channelId);
      const arr = byScene.get(id) ?? [];
      arr.push(ev);
      byScene.set(id, arr);
    }
    const lines: string[] = [];
    for (const [id, events] of byScene) {
      if (events.length === 1) {
        const e = events[0];
        lines.push(`· #${e.channelId}(${e.platform}) — 1 条未处理: "@${e.userId}: ${truncatePlatformText(e.content ?? "", 60)}"`);
      } else {
        lines.push(`· #${id} — ${events.length} 条未处理`);
      }
    }
    return lines;
  }

  clearAwarenessForFocus(): void {
    // Once focus has been handled, callers may wish to clear processed items.
    // Current policy: awareness is ephemeral per turn — callers drain by re-routing.
    this.pendingAwareness.length = 0;
  }
}
