export interface OneBotRequestConfig {
  readonly timeoutMs?: number;
  readonly retries?: number;
}

export interface OneBotReconnectConfig {
  readonly enabled?: boolean;
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
}

export interface OneBotConfig {
  readonly id?: string;
  readonly name?: string;
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly accessToken?: string;
  readonly selfId?: string;
  readonly request?: OneBotRequestConfig;
  readonly reconnect?: OneBotReconnectConfig;
}

export interface ResolvedOneBotConfig {
  readonly id: string;
  readonly name: string;
  readonly wsUrl: string;
  readonly httpUrl: string;
  readonly accessToken?: string;
  readonly selfId?: string;
  readonly request: Required<OneBotRequestConfig>;
  readonly reconnect: Required<OneBotReconnectConfig>;
}

export function resolveOneBotConfig(config: OneBotConfig): ResolvedOneBotConfig {
  return {
    id: config.id ?? "onebot",
    name: config.name ?? "OneBot",
    wsUrl: config.wsUrl,
    httpUrl: config.httpUrl,
    ...(config.accessToken === undefined ? {} : { accessToken: config.accessToken }),
    ...(config.selfId === undefined ? {} : { selfId: config.selfId }),
    request: {
      timeoutMs: config.request?.timeoutMs ?? 10_000,
      retries: config.request?.retries ?? 2,
    },
    reconnect: {
      enabled: config.reconnect?.enabled ?? true,
      maxAttempts: config.reconnect?.maxAttempts ?? 10,
      baseDelayMs: config.reconnect?.baseDelayMs ?? 1_000,
      maxDelayMs: config.reconnect?.maxDelayMs ?? 30_000,
    },
  };
}
