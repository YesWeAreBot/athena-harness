import type { WebSocket } from "@athena-ai/protocol-im";
import type { Dict } from "cosmokit";

// ─── Response ───────────────────────────────────────────────────────────────

export interface Response<T = unknown> {
  status: string;
  retcode: number;
  data: T;
  echo?: number;
}

// ─── Account / User ─────────────────────────────────────────────────────────

export interface AccountInfo {
  user_id: number;
  tiny_id?: string;
  nickname: string;
}

export interface StrangerInfo extends AccountInfo {
  sex: "male" | "female" | "unknown";
  age: number;
}

export interface SenderInfo extends StrangerInfo {
  card?: string;
  area?: string;
  level?: string;
  role?: GroupRole;
  title?: string;
}

export interface FriendInfo extends AccountInfo {
  remark: string;
}

// ─── Group / Guild ──────────────────────────────────────────────────────────

export type GroupRole = "member" | "admin" | "owner";

export interface GroupBase {
  group_id: number;
  group_name: string;
}

export interface GroupInfo extends GroupBase {
  member_count: number;
  max_member_count: number;
}

export interface GroupMemberInfo extends SenderInfo {
  group_id: number;
  join_time: number;
  last_sent_time: number;
  unfriendly: boolean;
  card_changeable: boolean;
}

export interface GuildBaseInfo {
  guild_id: string;
  guild_name: string;
}

export interface ChannelInfo {
  channel_id: string;
  channel_name: string;
  channel_type: number;
  create_time: number;
  creator_tiny_id: string;
  current_slow_mode: number;
  talk_permission: number;
  visible_type: number;
  slow_modes: SlowModeInfo[];
}

export interface SlowModeInfo {
  slow_mode_key: number;
  slow_mode_text: string;
  speak_frequency: number;
  slow_mode_circle: number;
}

// ─── Message ────────────────────────────────────────────────────────────────

export interface MessageId {
  message_id: number;
}

export interface CQCode {
  type: string;
  data: Record<string, string>;
}

export interface Message extends MessageId {
  time: number;
  message_type: "private" | "group" | "guild";
  sender: SenderInfo;
  group_id?: number;
  guild_id?: string;
  channel_id?: string;
  message: string | CQCode[];
  message_seq?: number;
}

// ─── Payload (incoming event) ───────────────────────────────────────────────

export interface Payload extends Message {
  post_type: string;
  sub_type: string;
  self_id: number;
  self_tiny_id?: string;
  user_id: number;
  target_id?: number;
  operator_id?: number;
  notice_type?: string;
  request_type?: string;
  flag?: string;
  comment?: string;
  honor_type?: string;
  file?: FileInfo;
}

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  busid?: number;
  url?: string;
}

// ─── Forward Message ────────────────────────────────────────────────────────

export interface ForwardMessage {
  content: string | CQCode[];
  sender: AccountInfo;
  time: number;
}

// ─── File System ────────────────────────────────────────────────────────────

export interface GroupFileSystemInfo {
  file_count: number;
  limit_count: number;
  used_space: number;
  total_space: number;
}

export interface GroupFile {
  group_id: number;
  file_id: string;
  file_name: string;
  busid: number;
  file_size: number;
  upload_time: number;
  dead_time: number;
  modify_time: number;
  download_times: number;
  uploader: number;
  uploader_name: string;
}

export interface GroupFolder {
  group_id: number;
  folder_id: string;
  folder_name: string;
  create_time: number;
  creator: number;
  creator_name: string;
  total_file_count: number;
}

export interface GroupFileList {
  files: GroupFile[];
  folders: GroupFolder[];
}

// ─── Misc ───────────────────────────────────────────────────────────────────

export interface ReactionInfo {
  emoji_id: string;
  emoji_index: number;
  emoji_type: number;
  emoji_name: string;
  count: number;
  clicked: boolean;
}

export interface VersionInfo {
  app_name: string;
  app_version: string;
  protocol_version: string;
  [key: string]: string;
}

export interface EssenceMsg {
  message_id: number;
  sender_id: number;
  operator_id: number;
  message: string | CQCode[];
}

export interface OcrResult {
  texts: Array<{ text: string; confidence: number; coordinates: Array<{ x: number; y: number }> }>;
  language: string;
}

export interface StatusInfo {
  online: boolean;
  good: boolean;
}

// ─── Internal API ───────────────────────────────────────────────────────────

type Id = string | number;

/**
 * Typed interface for OneBot Internal API methods.
 * Methods are auto-generated via Internal.define/defineExtract.
 * The class below intentionally merges with this interface (koishi pattern):
 * the interface declares the typed surface, the class provides the dynamic implementation.
 */
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: interface declares types, class implements dynamically (koishi pattern)
export interface Internal {
  // messages
  sendMsg(userId: Id, groupId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<number>;
  sendPrivateMsg(userId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<number>;
  sendGroupMsg(groupId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<number>;
  sendGroupForwardMsg(groupId: Id, messages: readonly CQCode[]): Promise<number>;
  sendPrivateForwardMsg(userId: Id, messages: readonly CQCode[]): Promise<number>;
  deleteMsg(messageId: Id): Promise<void>;
  markMsgAsRead(messageId: Id): Promise<void>;
  setEssenceMsg(messageId: Id): Promise<void>;
  deleteEssenceMsg(messageId: Id): Promise<void>;
  sendGroupSign(groupId: Id): Promise<void>;
  sendLike(userId: Id, times?: number): Promise<void>;
  getMsg(messageId: Id): Promise<Message>;
  getForwardMsg(messageId: Id): Promise<ForwardMessage[]>;
  getEssenceMsgList(groupId: Id): Promise<EssenceMsg[]>;
  ocrImage(image: string): Promise<OcrResult>;
  getGroupMsgHistory(groupId: Id, messageSeq?: number): Promise<{ messages: Message[] }>;
  getFriendMsgHistory(userId: Id, messageSeq?: number, count?: number, reverseOrder?: boolean): Promise<Message[]>;

  // requests
  setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<void>;
  setGroupAddRequest(flag: string, subType: "add" | "invite", approve: boolean, reason?: string): Promise<void>;

  // group operations
  setGroupKick(groupId: Id, userId: Id, rejectAddRequest?: boolean): Promise<void>;
  setGroupBan(groupId: Id, userId: Id, duration?: number): Promise<void>;
  setGroupWholeBan(groupId: Id, enable?: boolean): Promise<void>;
  setGroupAdmin(groupId: Id, userId: Id, enable?: boolean): Promise<void>;
  setGroupCard(groupId: Id, userId: Id, card?: string): Promise<void>;
  setGroupLeave(groupId: Id, isDismiss?: boolean): Promise<void>;
  setGroupSpecialTitle(groupId: Id, userId: Id, specialTitle?: string, duration?: number): Promise<void>;
  setGroupName(groupId: Id, groupName: string): Promise<void>;

  // accounts
  getLoginInfo(): Promise<AccountInfo>;
  getStrangerInfo(userId: Id, noCache?: boolean): Promise<StrangerInfo>;
  getFriendList(): Promise<FriendInfo[]>;
  deleteFriend(userId: Id): Promise<void>;

  // group info
  getGroupInfo(groupId: Id, noCache?: boolean): Promise<GroupInfo>;
  getGroupList(noCache?: boolean): Promise<GroupInfo[]>;
  getGroupMemberInfo(groupId: Id, userId: Id, noCache?: boolean): Promise<GroupMemberInfo>;
  getGroupMemberList(groupId: Id, noCache?: boolean): Promise<GroupMemberInfo[]>;

  // files
  getGroupFileSystemInfo(groupId: Id): Promise<GroupFileSystemInfo>;
  getGroupRootFiles(groupId: Id): Promise<GroupFileList>;
  getGroupFilesByFolder(groupId: Id, folderId: string): Promise<GroupFileList>;
  getGroupFileUrl(groupId: Id, fileId: string, busid: number): Promise<string>;
  downloadFile(url: string, headers?: string | readonly string[], threadCount?: number): Promise<string>;
  uploadPrivateFile(userId: Id, file: string, name: string): Promise<void>;
  uploadGroupFile(groupId: Id, file: string, name: string, folder?: string): Promise<void>;

  // reaction
  setMsgEmojiLike(messageId: Id, emojiId: Id, set?: boolean): Promise<void>;

  // guild (QQ频道)
  getGuildList(): Promise<GuildBaseInfo[]>;
  getGuildChannelList(guildId: Id, noCache?: boolean): Promise<ChannelInfo[]>;
  sendGuildChannelMsg(guildId: Id, channelId: Id, message: string | readonly CQCode[]): Promise<number>;

  // system
  getVersionInfo(): Promise<VersionInfo>;
  getStatus(): Promise<StatusInfo>;
  setRestart(delay?: number): Promise<void>;
}

export class TimeoutError extends Error {
  constructor(
    public params: Dict,
    public action: string,
  ) {
    super(`Timeout with request ${action}, args: ${JSON.stringify(params)}`);
  }
}

class SenderError extends Error {
  public code: number;

  constructor(params: Dict, action: string, retcode: number) {
    super(`Error with request ${action}, args: ${JSON.stringify(params)}, retcode: ${retcode}`);
    this.code = retcode;
  }
}

/**
 * OneBot Internal API implementation.
 * Methods are generated dynamically via define/defineExtract.
 */
export class Internal {
  _request?: (action: string, params: Dict) => Promise<Response>;

  /** Pending request resolvers keyed by echo. */
  private listeners = new Map<number, { resolve: (response: Response) => void; timer: NodeJS.Timeout }>();
  private counter = 0;

  constructor(public readonly selfId: string) {}

  /** Allocate the next echo id for a request. */
  nextEcho(): number {
    return ++this.counter;
  }

  /**
   * Send a request over a live socket and await its response.
   * Rejects on timeout; the pending entry is always cleaned up.
   */
  request(socket: WebSocket, payload: { action: string; params: Dict; echo: number }): Promise<Response> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(payload.echo);
        reject(new TimeoutError(payload.params, payload.action));
      }, 15000);
      this.listeners.set(payload.echo, { resolve, timer });
      socket.send(JSON.stringify(payload));
    });
  }

  /** Route an incoming response to its pending request. */
  accept(response: Response): void {
    if (response.echo === undefined) return;
    const entry = this.listeners.get(response.echo);
    if (!entry) return;
    this.listeners.delete(response.echo);
    clearTimeout(entry.timer);
    entry.resolve(response);
  }

  private async _get<T = unknown>(action: string, params: Dict = {}): Promise<T> {
    if (!this._request) throw new Error("OneBot connection is not available");
    const response = await this._request(action, params);
    if (response.retcode === 0) {
      // SAFETY: the caller supplies the expected data type via the generic parameter.
      return response.data as T;
    }
    throw new SenderError(params, action, response.retcode);
  }

  private static asyncPrefixes = ["set", "send", "delete", "create", "upload", "move", "rename"];

  private static camelize(name: string): string {
    return name.replace(/^[_.]/, "").replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  }

  private static prepareArg(name: string, params: string[], args: unknown[]): Dict {
    const fixedArg: Dict = {};
    for (let i = 0; i < params.length; i++) {
      if (args[i] !== undefined) {
        const key = params[i];
        let value = args[i];
        // Convert numeric IDs for non-guild endpoints.
        // oxlint-disable-next-line anti-slop/no-runtime-typeof -- runtime guard: string IDs are narrowed to numbers when they fit.
        if (!name.includes("guild") && key.endsWith("_id") && typeof value === "string") {
          const num = +value;
          if (Math.abs(num) < 4294967296) value = num;
        }
        fixedArg[key] = value;
      }
    }
    return fixedArg;
  }

  static define(name: string, ...params: string[]): void {
    const prop = Internal.camelize(name);
    const isAsync = Internal.asyncPrefixes.some((prefix) => prop.startsWith(prefix));
    // SAFETY: prototype is a Dict-like object; assigning dynamic methods is the koishi pattern.
    (Internal.prototype as Dict)[prop] = async function (this: Internal, ...args: unknown[]) {
      const data = await this._get(name, Internal.prepareArg(name, params, args));
      if (!isAsync) return data;
    };
  }

  static defineExtract(name: string, key: string, ...params: string[]): void {
    const prop = Internal.camelize(name);
    // SAFETY: prototype is a Dict-like object; assigning dynamic methods is the koishi pattern.
    (Internal.prototype as Dict)[prop] = async function (this: Internal, ...args: unknown[]) {
      const data = await this._get<Dict>(name, Internal.prepareArg(name, params, args));
      return data[key];
    };
  }
}

// ─── Register API methods ───────────────────────────────────────────────────

// messages
Internal.defineExtract("send_msg", "message_id", "user_id", "group_id", "message", "auto_escape");
Internal.defineExtract("send_private_msg", "message_id", "user_id", "message", "auto_escape");
Internal.defineExtract("send_group_msg", "message_id", "group_id", "message", "auto_escape");
Internal.defineExtract("send_group_forward_msg", "message_id", "group_id", "messages");
Internal.defineExtract("send_private_forward_msg", "message_id", "user_id", "messages");
Internal.define("delete_msg", "message_id");
Internal.define("mark_msg_as_read", "message_id");
Internal.define("set_essence_msg", "message_id");
Internal.define("delete_essence_msg", "message_id");
Internal.define("send_group_sign", "group_id");
Internal.define("send_like", "user_id", "times");
Internal.define("get_msg", "message_id");
Internal.define("get_essence_msg_list", "group_id");
Internal.define("ocr_image", "image");
Internal.defineExtract("get_forward_msg", "messages", "message_id");
Internal.define("get_group_msg_history", "group_id", "message_seq");
Internal.defineExtract("get_friend_msg_history", "messages", "user_id", "message_seq", "count", "reverseOrder");

// requests
Internal.define("set_friend_add_request", "flag", "approve", "remark");
Internal.define("set_group_add_request", "flag", "sub_type", "approve", "reason");

// group operations
Internal.define("set_group_kick", "group_id", "user_id", "reject_add_request");
Internal.define("set_group_ban", "group_id", "user_id", "duration");
Internal.define("set_group_whole_ban", "group_id", "enable");
Internal.define("set_group_admin", "group_id", "user_id", "enable");
Internal.define("set_group_card", "group_id", "user_id", "card");
Internal.define("set_group_leave", "group_id", "is_dismiss");
Internal.define("set_group_special_title", "group_id", "user_id", "special_title", "duration");
Internal.define("set_group_name", "group_id", "group_name");

// accounts
Internal.define("get_login_info");
Internal.define("get_stranger_info", "user_id", "no_cache");
Internal.define("get_friend_list");
Internal.define("delete_friend", "user_id");

// group info
Internal.define("get_group_info", "group_id", "no_cache");
Internal.define("get_group_list", "no_cache");
Internal.define("get_group_member_info", "group_id", "user_id", "no_cache");
Internal.define("get_group_member_list", "group_id");

// files
Internal.define("get_group_file_system_info", "group_id");
Internal.define("get_group_root_files", "group_id");
Internal.define("get_group_files_by_folder", "group_id", "folder_id");
Internal.defineExtract("get_group_file_url", "url", "group_id", "file_id", "busid");
Internal.defineExtract("download_file", "file", "url", "headers", "thread_count");
Internal.define("upload_private_file", "user_id", "file", "name");
Internal.define("upload_group_file", "group_id", "file", "name", "folder");

// reaction
Internal.define("set_msg_emoji_like", "message_id", "emoji_id", "set");

// guild
Internal.define("get_guild_list");
Internal.define("get_guild_channel_list", "guild_id", "no_cache");
Internal.defineExtract("send_guild_channel_msg", "message_id", "guild_id", "channel_id", "message");

// system
Internal.define("get_version_info");
Internal.define("get_status");
Internal.define("set_restart", "delay");
