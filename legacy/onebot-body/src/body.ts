import type { Actuator, ActuatorContext, ActuatorResult, BodyAdapter, BodyAdapterContext } from "@yesimbot/athena-runtime";

import { OneBotApiClient, OneBotApiError } from "./api.js";
import type { ResolvedOneBotConfig } from "./config.js";
import { mapOneBotPercept, oneBotChannelKey, parseOneBotEvent } from "./mapping.js";
import { OneBotWebSocketClient } from "./transport.js";
import type { OneBotBodyState } from "./types.js";

interface SendMessageAction {
  readonly userId?: string | number;
  readonly groupId?: string | number;
  readonly message: unknown;
}

interface SendPrivateAction {
  readonly userId?: string | number;
  readonly message: unknown;
}

interface SendGroupAction {
  readonly groupId?: string | number;
  readonly message: unknown;
}

interface RecallAction {
  readonly messageId?: string | number;
}

interface SendLikeAction {
  readonly userId?: string | number;
  readonly times?: number;
}

export class OneBotBodyAdapter implements BodyAdapter {
  readonly id: string;
  readonly name: string;
  readonly senses = [{ id: "message", kind: "chat" }];
  readonly actuators: readonly Actuator[];

  private readonly apiClient: OneBotApiClient;
  private transport?: OneBotWebSocketClient;
  private context?: BodyAdapterContext;

  constructor(private readonly config: ResolvedOneBotConfig) {
    this.id = config.id;
    this.name = config.name;
    this.apiClient = new OneBotApiClient(config);
    this.actuators = [
      {
        id: "send",
        kind: "chat",
        act: async (action, context) => {
          const input = action as SendMessageAction;
          if (input.message === undefined) return errorResult("message is required");
          if (input.userId === undefined && input.groupId === undefined) {
            return errorResult("userId or groupId is required");
          }
          try {
            const response = await this.apiClient.sendMessage(input, { signal: context?.signal });
            return okResult(response.data);
          } catch (error) {
            return actuatorError(context, error);
          }
        },
      },
      {
        id: "send_private",
        kind: "chat",
        act: async (action, context) => {
          const input = action as SendPrivateAction;
          if (input.userId === undefined) return errorResult("userId is required");
          if (input.message === undefined) return errorResult("message is required");
          try {
            const response = await this.apiClient.sendPrivate(input.userId, input.message, { signal: context?.signal });
            return okResult(response.data);
          } catch (error) {
            return actuatorError(context, error);
          }
        },
      },
      {
        id: "send_group",
        kind: "chat",
        act: async (action, context) => {
          const input = action as SendGroupAction;
          if (input.groupId === undefined) return errorResult("groupId is required");
          if (input.message === undefined) return errorResult("message is required");
          try {
            const response = await this.apiClient.sendGroup(input.groupId, input.message, { signal: context?.signal });
            return okResult(response.data);
          } catch (error) {
            return actuatorError(context, error);
          }
        },
      },
      {
        id: "recall",
        kind: "chat",
        act: async (action, context) => {
          const input = action as RecallAction;
          if (input.messageId === undefined) return errorResult("messageId is required");
          try {
            const response = await this.apiClient.recall(input.messageId, { signal: context?.signal });
            return okResult(response.data);
          } catch (error) {
            return actuatorError(context, error);
          }
        },
      },
      {
        id: "send_like",
        kind: "chat",
        act: async (action, context) => {
          const input = action as SendLikeAction;
          if (input.userId === undefined) return errorResult("userId is required");
          const times = input.times ?? 1;
          if (!Number.isInteger(times) || times < 1) return errorResult("times must be a positive integer");
          try {
            const response = await this.apiClient.sendLike(input.userId, times, { signal: context?.signal });
            return okResult(response.data);
          } catch (error) {
            return actuatorError(context, error);
          }
        },
      },
    ];
  }

  get api(): OneBotApiClient {
    return this.apiClient;
  }

  async start(context: BodyAdapterContext): Promise<void> {
    this.context = context;
    context.patchState({
      connection: "connecting",
      ...(this.config.selfId === undefined ? {} : { selfId: this.config.selfId }),
    });
    const transport = new OneBotWebSocketClient(this.config, {
      onMessage: (raw) => this.handleRaw(raw),
      onStatus: (connection, error) => this.updateState(connection, error),
    });
    this.transport = transport;
    try {
      await transport.connect();
    } catch (error) {
      transport.disconnect();
      this.transport = undefined;
      context.patchState({ connection: "disconnected", lastError: error });
      throw error;
    }
  }

  async stop(): Promise<void> {
    const context = this.context;
    this.transport?.disconnect();
    this.transport = undefined;
    context?.patchState({ connection: "disconnected" });
    this.context = undefined;
  }

  private handleRaw(raw: string): void {
    const context = this.context;
    if (!context) return;
    try {
      const event = parseOneBotEvent(JSON.parse(raw));
      if (event.post_type === "meta_event") {
        context.patchState({ lastEventAt: Date.now() });
        return;
      }
      const percept = mapOneBotPercept(event);
      const actorId = event.user_id === undefined ? undefined : String(event.user_id);
      const actorName = resolveActorName(event.sender);
      const channelKey = oneBotChannelKey(event);
      context.dispatch(percept.kind, percept.data, {
        source: "onebot",
        ...(actorId === undefined ? {} : { actor: { id: actorId, ...(actorName === undefined ? {} : { name: actorName }) } }),
        target: {
          id: channelKey,
          kind: event.message_type ?? "onebot-channel",
        },
      });
      context.patchState({ lastEventAt: Date.now() });
    } catch (error) {
      context.patchState({ lastError: error });
    }
  }

  private updateState(connection: OneBotBodyState["connection"], error?: unknown): void {
    this.context?.patchState({
      connection,
      ...(error === undefined ? {} : { lastError: error }),
    });
  }
}

function okResult(output?: unknown): ActuatorResult {
  return output === undefined ? { status: "ok" } : { status: "ok", output };
}

function errorResult(error: string): ActuatorResult {
  return { status: "error", error, retryable: false };
}

function actuatorError(context: ActuatorContext | undefined, error: unknown): ActuatorResult {
  if (context?.signal?.aborted) {
    return { status: "canceled", error, retryable: false };
  }
  return {
    status: "error",
    error,
    retryable: error instanceof OneBotApiError ? error.retryable : true,
  };
}

function resolveActorName(sender: unknown): string | undefined {
  if (!sender || typeof sender !== "object") return undefined;
  const record = sender as Record<string, unknown>;
  const card = record.card;
  const nickname = record.nickname;
  const name = typeof card === "string" && card.length > 0 ? card : nickname;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}
