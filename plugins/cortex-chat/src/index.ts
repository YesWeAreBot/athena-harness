import { Schema } from "@athena-ai/core";
import { CortexService } from "@athena-ai/protocol";
import type { IMMessageEvent } from "@athena-ai/protocol-im";
import type { Context } from "cordis";
import { Logger } from "cordis";

import { Attention } from "./attention.js";
import { type Checkpoint, createCheckpoint, emptyCheckpoint, loadCheckpoint, saveCheckpoint } from "./checkpoint.js";
import { compact, estimateTokens, extractConversationText } from "./compaction.js";
import { CortexChatConfig, CortexChatConfigSchema } from "./config.js";
import { AgentLoop } from "./loop.js";
import { MessageStore } from "./message-store.js";
import { buildFrameMessage, buildSystemMessages } from "./prompt.js";
import { TurnQueue } from "./queue.js";
import { type WsMessage, WorkspaceStore } from "./workspace-store.js";

class CortexChat extends CortexService {
  public static readonly name = "cortex-chat";
  public static readonly inject = ["life", "nerve", "ai", "database", "tools"];

  public readonly config: CortexChat.Config;
  public readonly logger: Logger;
  public readonly messages: MessageStore;
  public readonly workspace: WorkspaceStore;

  private readonly queue: TurnQueue;
  private readonly attention: Attention;
  private checkpoint: Checkpoint;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: Context, config: CortexChat.Config) {
    super(ctx, "cortex");

    this.config = config;
    this.logger = ctx.logger("cortex-chat");
    this.messages = new MessageStore(ctx);
    this.workspace = new WorkspaceStore(ctx);
    this.queue = new TurnQueue(ctx, { logger: this.logger });
    this.attention = new Attention({
      store: this.messages,
      initialFocus: config.initialFocus || null,
    });
    this.checkpoint = emptyCheckpoint();

    // Load checkpoint on start
    void this.initialize();

    ctx.on("message-created", (event: IMMessageEvent) => {
      void this.onMessage(event);
    });
  }

  private async initialize(): Promise<void> {
    const saved = await loadCheckpoint();
    if (saved) {
      this.checkpoint = saved;
      if (saved.focusSceneId) {
        const at = saved.focusSceneId.indexOf(":");
        if (at !== -1) {
          this.attention.setFocus(saved.focusSceneId.slice(0, at), saved.focusSceneId.slice(at + 1));
        }
      }
    }
  }

  private async onMessage(event: IMMessageEvent): Promise<void> {
    if (event.userId === event.selfId) return;

    // Archive every incoming message unconditionally
    await this.messages.store({
      platform: event.platform,
      id: event.messageId,
      channelId: event.channelId,
      userId: event.userId,
      content: event.content,
      timestamp: event.timestamp,
    });

    // Route through attention
    const routed = await this.attention.route(event);

    if (routed.kind === "ignore") return;

    if (routed.kind === "background") {
      // Focus non-trigger: append to workspace without firing a turn
      await this.workspace.append(...routed.messages);
      return;
    }

    // trigger or awareness → fire a turn
    this.clearIdleTimer();
    await this.fireTurn(routed.messages);
  }

  private async fireTurn(messages: WsMessage[]): Promise<void> {
    const snap = this.attention.snapshot();
    const model = this.ctx.ai.language(this.config.model || undefined);

    // Build system prompt
    const systemMessages = buildSystemMessages({
      persona: this.ctx.life.persona,
      compaction: this.checkpoint.compaction,
    });
    const system = systemMessages.map((m) => (m as { content: string }).content).join("\n\n");

    // Build frame message for context
    const history =
      snap.focusChannelId && snap.focusPlatform
        ? await this.messages.getByChannel(snap.focusPlatform, snap.focusChannelId, { limit: this.config.historyLimit })
        : [];

    const frame = buildFrameMessage({
      focusChannelId: snap.focusChannelId,
      focusPlatform: snap.focusPlatform,
      isDirect: false,
      history,
      awarenessLines: this.attention.awarenessFrameLines(),
    });

    // Append frame context to workspace before the turn
    void frame; // Frame is part of system context, not workspace messages

    const loop = new AgentLoop({
      ctx: this.ctx,
      workspace: this.workspace,
      messageStore: this.messages,
      queue: this.queue,
      logger: this.logger,
      maxSteps: this.config.maxSteps,
      model,
      system,
      compaction: this.checkpoint.compaction,
      focusSceneId: snap.focusSceneId,
      pacing: this.config.pacing,
      customInnerThought: this.config.customInnerThought,
      onFocusSwitched: async (platform, channelId) => {
        await this.handleFocusSwitch(platform, channelId);
      },
    });

    await loop.run(messages);

    // Post-turn: check compaction threshold and schedule idle timer
    await this.postTurnCompaction();
    this.scheduleIdleCompaction();
  }

  private async handleFocusSwitch(platform: string, channelId: string): Promise<void> {
    this.attention.setFocus(platform, channelId);
    this.attention.clearAwarenessForFocus();

    // Save current checkpoint before rebuilding
    this.checkpoint = createCheckpoint({
      focusSceneId: this.attention.snapshot().focusSceneId,
      frameMessages: [],
      compaction: this.checkpoint.compaction,
    });
    await saveCheckpoint(this.checkpoint);
  }

  private async postTurnCompaction(): Promise<void> {
    const all = await this.workspace.readAll();
    const text = extractConversationText(all);
    const tokens = estimateTokens(text);

    if (tokens >= this.config.compactThreshold) {
      await this.runCompaction();
    }
  }

  private async runCompaction(): Promise<void> {
    const all = await this.workspace.readAll();
    const compactModel = this.config.compactModel || this.config.model || undefined;
    const model = this.ctx.ai.language(compactModel);

    const compacted = await compact({
      workspace: all,
      previousCompaction: this.checkpoint.compaction,
      persona: this.ctx.life.persona,
      personaName: "Athena",
      model,
    });

    this.checkpoint = createCheckpoint({
      focusSceneId: this.attention.snapshot().focusSceneId,
      frameMessages: [],
      compaction: compacted,
    });
    await saveCheckpoint(this.checkpoint);
    await this.workspace.clear();
  }

  private scheduleIdleCompaction(): void {
    if (this.config.idleTimeout <= 0) return;
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      void this.runCompaction();
    }, this.config.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer !== null) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}

namespace CortexChat {
  export type Config = CortexChatConfig;
  export const Config: Schema<Config> = CortexChatConfigSchema as Schema<Config>;
}

export default CortexChat;
