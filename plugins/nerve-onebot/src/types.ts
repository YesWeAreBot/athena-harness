import type { OneBotBody } from "./body.js";
export interface CQCode {
  type: string;
  data: Record<string, string>;
}

export interface Response<T = unknown> {
  status: string;
  retcode: number;
  data: T;
  echo?: number;
}

export interface AccountInfo {
  user_id: number;
  tiny_id?: string;
  nickname: string;
}

export interface SenderInfo extends AccountInfo {
  sex: "male" | "female" | "unknown";
  age: number;
  card?: string;
  role?: "member" | "admin" | "owner";
}

export interface Message {
  message_id: number;
  time: number;
  message_type: "private" | "group" | "guild";
  sender: SenderInfo;
  group_id?: number;
  guild_id?: string;
  channel_id?: string;
  message: string | CQCode[];
}

export interface MessagePayload extends Message {
  post_type: "message" | "message_sent";
  sub_type: string;
  self_id: number;
  user_id: number;
  target_id?: number;
}

export interface NoticePayload {
  post_type: "notice";
  notice_type: string;
  self_id: number;
  time: number;
  user_id?: number;
  group_id?: number;
}
export interface UnsupportedPayload {
  post_type: string;
}

export type Payload = MessagePayload | NoticePayload | UnsupportedPayload;

export interface RequestParams {
  user_id?: string;
  group_id?: string;
  message?: CQCode[];
  message_id?: string;
}

export class Internal {
  _request?: (action: string, params: RequestParams) => Promise<Response>;

  constructor(public readonly body: OneBotBody) {}

  private async request<T>(action: string, params: RequestParams): Promise<T> {
    if (!this._request) throw new Error("OneBot connection is not available");
    const response = await this._request(action, params);
    if (response.retcode !== 0) throw new Error(`OneBot request failed: ${action} (${response.retcode})`);
    // SAFETY: Each typed Internal method pairs its action with the corresponding OneBot response data shape.
    return response.data as T;
  }

  async sendPrivateMsg(userId: string, message: CQCode[]): Promise<number> {
    const result = await this.request<{ message_id: number }>("send_private_msg", { user_id: userId, message });
    return result.message_id;
  }

  async sendGroupMsg(groupId: string, message: CQCode[]): Promise<number> {
    const result = await this.request<{ message_id: number }>("send_group_msg", { group_id: groupId, message });
    return result.message_id;
  }

  getMsg(messageId: string): Promise<Message> {
    return this.request<Message>("get_msg", { message_id: messageId });
  }

  getLoginInfo(): Promise<AccountInfo> {
    return this.request<AccountInfo>("get_login_info", {});
  }
}
