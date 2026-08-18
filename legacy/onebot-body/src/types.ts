export type OneBotConnectionStatus = "connecting" | "connected" | "disconnected";

export interface OneBotMessageSegment {
  readonly type: string;
  readonly data: Record<string, unknown>;
}

export interface OneBotEvent {
  readonly post_type: string;
  readonly self_id?: number | string;
  readonly time?: number;
  readonly message_type?: "private" | "group" | "guild" | string;
  readonly sub_type?: string;
  readonly message_id?: number | string;
  readonly user_id?: number | string;
  readonly group_id?: number | string;
  readonly guild_id?: number | string;
  readonly channel_id?: number | string;
  readonly target_id?: number | string;
  readonly operator_id?: number | string;
  readonly raw_message?: string;
  readonly message?: unknown;
  readonly sender?: Readonly<Record<string, unknown>>;
  readonly notice_type?: string;
  readonly request_type?: string;
  readonly meta_event_type?: string;
  readonly comment?: string;
  readonly flag?: string;
  readonly [key: string]: unknown;
}

export interface NormalizedOneBotEvent {
  readonly postType: string;
  readonly selfId?: string;
  readonly time?: number;
  readonly messageType?: string;
  readonly subType?: string;
  readonly messageId?: string;
  readonly userId?: string;
  readonly groupId?: string;
  readonly guildId?: string;
  readonly channelId?: string;
  readonly targetId?: string;
  readonly operatorId?: string;
  readonly rawMessage?: string;
  readonly message?: readonly OneBotMessageSegment[];
  readonly sender?: Readonly<Record<string, unknown>>;
  readonly noticeType?: string;
  readonly requestType?: string;
  readonly metaEventType?: string;
  readonly comment?: string;
  readonly flag?: string;
  readonly raw: OneBotEvent;
}

export interface OneBotPercept {
  readonly kind: string;
  readonly data: Record<string, unknown>;
}

export interface OneBotBodyState {
  readonly connection: OneBotConnectionStatus;
  readonly selfId?: string;
  readonly lastEventAt?: number;
  readonly lastError?: unknown;
}
