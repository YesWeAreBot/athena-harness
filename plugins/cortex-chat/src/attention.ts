import type { UserModelMessage } from "@athena-ai/core";
import type { IMMessageEvent } from "@athena-ai/protocol-im";

import type { MessageStore, StoredMessage } from "./message-store.js";
import { renderAwarenessMessage } from "./render.js";
import { encodeSceneAddress, sameScene, type SceneAddress, type SceneCursor } from "./scene.js";
import { shouldTrigger } from "./trigger.js";

export interface AttentionSnapshot {
  readonly frameFocus: SceneAddress | null;
  readonly logicalFocus: SceneAddress | null;
}

export type RouteResult =
  | { readonly kind: "ignore" }
  | { readonly kind: "background"; readonly messages: readonly UserModelMessage[] }
  | { readonly kind: "trigger"; readonly messages: readonly UserModelMessage[] }
  | { readonly kind: "awareness"; readonly messages: readonly UserModelMessage[] };

export interface AttentionOptions {
  readonly store: MessageStore;
  readonly initialFocus: SceneAddress | null;
  readonly awarenessHistoryLimit?: number;
  readonly onColdStart?: (focus: SceneAddress) => Promise<void> | void;
}

export interface AttentionObservation {
  readonly event: IMMessageEvent;
  readonly stored: StoredMessage;
  readonly message: UserModelMessage;
}

export interface SwitchFocusTransition {
  readonly from: SceneAddress | null;
  readonly to: SceneAddress;
}

function sceneFromStored(stored: StoredMessage): SceneAddress {
  return { bodySid: stored.bodySid, channelId: stored.channelId };
}

export class Attention {
  private _frameFocus: SceneAddress | null;
  private _logicalFocus: SceneAddress | null;
  /** Per-scene high-water mark: the newest context message delivered in the last awareness for that scene. */
  private readonly awarenessHighWater = new Map<string, SceneCursor>();

  constructor(private readonly opts: AttentionOptions) {
    this._frameFocus = opts.initialFocus;
    this._logicalFocus = opts.initialFocus;
  }

  /** Reset all awareness cursors — call after compaction so the next awareness delivers a fresh window. */
  resetAwarenessCursors(): void {
    this.awarenessHighWater.clear();
  }

  snapshot(): AttentionSnapshot {
    return {
      frameFocus: this._frameFocus,
      logicalFocus: this._logicalFocus,
    };
  }

  /** Restore the durable checkpoint focus before any turn can begin. */
  restoreFocus(focus: SceneAddress | null): void {
    if (sameScene(this._frameFocus, focus) && sameScene(this._logicalFocus, focus)) return;
    this._frameFocus = focus;
    this._logicalFocus = focus;
  }

  switchFocus(target: SceneAddress): SwitchFocusTransition {
    const from = this._logicalFocus;
    if (sameScene(from, target)) return { from, to: target };
    this._logicalFocus = target;
    return { from, to: target };
  }

  /** Adopt logical focus after a checkpoint has committed the corresponding frame. */
  promoteFocus(): SceneAddress | null {
    if (sameScene(this._frameFocus, this._logicalFocus)) return this._frameFocus;
    this._frameFocus = this._logicalFocus;
    return this._frameFocus;
  }

  async route(observation: AttentionObservation): Promise<RouteResult> {
    const { event, stored, message } = observation;
    const scene = sceneFromStored(stored);
    const trigger = shouldTrigger(event);
    const hasFocus = this._logicalFocus !== null || this._frameFocus !== null;
    const isFocus = this._logicalFocus !== null && sameScene(this._logicalFocus, scene);

    if (trigger && !hasFocus) {
      this._frameFocus = scene;
      this._logicalFocus = scene;
      await this.opts.onColdStart?.(scene);
      return { kind: "trigger", messages: [message] };
    }

    if (isFocus) {
      if (trigger) return { kind: "trigger", messages: [message] };
      return { kind: "background", messages: [message] };
    }

    if (!trigger) return { kind: "ignore" };

    const limit = Math.max(0, this.opts.awarenessHistoryLimit ?? 5);
    const sceneKey = encodeSceneAddress(scene);
    const cursor = this.awarenessHighWater.get(sceneKey);

    // First awareness for this scene: full window; subsequent: incremental after the cursor.
    const raw = limit === 0 ? [] : await this.opts.store.readScene(scene, { limit: limit + 1, ...(cursor ? { after: cursor } : {}) });
    const context = raw.filter((entry) => entry.messageId !== stored.messageId).slice(-limit);

    // Update high-water mark to the trigger message itself so the next awareness starts after it.
    this.awarenessHighWater.set(sceneKey, { timestamp: stored.timestamp, messageId: stored.messageId });

    // Count total scene history for the truncated hint (only when we have a cursor, meaning prior context was already delivered).
    let totalAvailable: number | undefined;
    if (cursor && limit > 0) {
      const full = await this.opts.store.readScene(scene, {});
      // Exclude the trigger message itself from the count.
      totalAvailable = full.filter((entry) => entry.messageId !== stored.messageId).length;
    }

    const triggerKind = event.isDirect ? "direct" : "mention";
    return {
      kind: "awareness",
      messages: [
        renderAwarenessMessage({
          message: stored,
          trigger: triggerKind,
          context,
          totalAvailable,
        }),
      ],
    };
  }
}
