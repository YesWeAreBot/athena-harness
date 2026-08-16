import type { ResolvedOneBotConfig } from "./config.js";

export interface OneBotApiResponse {
  readonly status?: string;
  readonly retcode?: number;
  readonly data?: unknown;
}

export interface OneBotRequestOptions {
  readonly signal?: AbortSignal;
  readonly retries?: number;
  readonly timeoutMs?: number;
}

export class OneBotApiError extends Error {
  readonly retryable: boolean;

  constructor(
    readonly path: string,
    readonly status: number,
    readonly response?: OneBotApiResponse,
    options: { readonly retryable?: boolean } = {},
  ) {
    super(`OneBot API failed: ${path} (${status})`);
    this.name = "OneBotApiError";
    this.retryable = options.retryable ?? false;
  }
}

export class OneBotRequestError extends Error {
  readonly retryable = true;

  constructor(
    readonly path: string,
    cause: unknown,
  ) {
    super(`OneBot request failed: ${path}`, { cause });
    this.name = "OneBotRequestError";
  }
}

export class OneBotApiClient {
  constructor(private readonly config: ResolvedOneBotConfig) {}

  async sendMessage(
    input: {
      readonly userId?: string | number;
      readonly groupId?: string | number;
      readonly message: unknown;
    },
    options: OneBotRequestOptions = {},
  ): Promise<OneBotApiResponse> {
    return this.request(
      "/send_msg",
      {
        message_type: input.groupId !== undefined ? "group" : "private",
        ...(input.userId === undefined ? {} : { user_id: input.userId }),
        ...(input.groupId === undefined ? {} : { group_id: input.groupId }),
        message: input.message,
      },
      options,
    );
  }

  async sendPrivate(userId: string | number, message: unknown, options: OneBotRequestOptions = {}): Promise<OneBotApiResponse> {
    return this.request("/send_private_msg", { user_id: userId, message }, options);
  }

  async sendGroup(groupId: string | number, message: unknown, options: OneBotRequestOptions = {}): Promise<OneBotApiResponse> {
    return this.request("/send_group_msg", { group_id: groupId, message }, options);
  }

  async recall(messageId: string | number, options: OneBotRequestOptions = {}): Promise<OneBotApiResponse> {
    return this.request("/delete_msg", { message_id: messageId }, options);
  }

  async sendLike(userId: string | number, times = 1, options: OneBotRequestOptions = {}): Promise<OneBotApiResponse> {
    return this.request("/send_like", { user_id: userId, times }, options);
  }

  private async request(path: string, params: Record<string, unknown>, options: OneBotRequestOptions = {}): Promise<OneBotApiResponse> {
    const attempts = Math.max(0, options.retries ?? this.config.request.retries) + 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (options.signal?.aborted) {
        throw abortError(options.signal);
      }
      try {
        return await this.attempt(path, params, options);
      } catch (error) {
        if (options.signal?.aborted) {
          throw abortError(options.signal);
        }
        lastError = error;
        if (attempt + 1 < attempts && isRetryable(error)) {
          await sleep(50 * (attempt + 1));
          continue;
        }
        break;
      }
    }
    throw lastError;
  }

  private async attempt(path: string, params: Record<string, unknown>, options: OneBotRequestOptions): Promise<OneBotApiResponse> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? this.config.request.timeoutMs;
    const timer = setTimeout(() => controller.abort(new Error(`OneBot request timed out: ${path}`)), timeoutMs);
    const abort = () => controller.abort(options.signal?.reason ?? new Error("request aborted"));
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (this.config.accessToken) headers.authorization = `Bearer ${this.config.accessToken}`;
      const response = await fetch(`${this.config.httpUrl}${path}`, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => null)) as OneBotApiResponse | null;
      if (!response.ok) {
        const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
        throw new OneBotApiError(path, response.status, data ?? undefined, { retryable });
      }
      if (data && !isOneBotSuccess(data)) {
        throw new OneBotApiError(path, response.status, data);
      }
      return data ?? {};
    } catch (error) {
      if (options.signal?.aborted) {
        throw abortError(options.signal);
      }
      if (error instanceof OneBotApiError) {
        throw error;
      }
      throw new OneBotRequestError(path, error);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
    }
  }
}

function isOneBotSuccess(response: OneBotApiResponse): boolean {
  if (response.retcode !== undefined) {
    return response.retcode === 0;
  }
  if (response.status !== undefined) {
    return response.status === "ok";
  }
  return true;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof OneBotRequestError) return true;
  if (error instanceof OneBotApiError) return error.retryable;
  return false;
}

function abortError(signal: AbortSignal): Error {
  const reason = signal.reason;
  const error = reason instanceof Error ? reason : new Error(reason === undefined ? "request aborted" : String(reason));
  error.name = "AbortError";
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
