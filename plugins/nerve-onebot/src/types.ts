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

export interface QidianAccountInfo {
  master_id: number;
  ext_name: string;
  create_time: number;
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

export interface UnidirectionalFriendInfo extends AccountInfo {
  source: string;
}

export interface VipInfo extends AccountInfo {
  level: number;
  level_speed: number;
  vip_level: string;
  vip_growth_speed: number;
  vip_growth_total: string;
}

export interface Credentials {
  cookies: string;
  csrf_token: number;
}

export interface Device {
  app_id: number;
  device_name: string;
  device_kind: string;
}

export interface ModelVariant {
  model_show: string;
  need_pay: boolean;
}

export enum SafetyLevel {
  safe,
  unknown,
  danger,
}

// ─── Group ───────────────────────────────────────────────────────────────────

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
  title_expire_time: number;
  unfriendly: boolean;
  card_changeable: boolean;
}

// ─── Message ────────────────────────────────────────────────────────────────

export interface MessageId {
  message_id: number;
}

export interface CQCode {
  type: string;
  data: Record<string, string>;
}

export interface AnonymousInfo {
  id: number;
  name: string;
  flag: string;
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
  anonymous?: AnonymousInfo;
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
  meta_event_type?: string;
  flag?: string;
  comment?: string;
  honor_type?: string;
  raw_message?: string;
  font?: number;
  file?: File;
  current_reactions?: ReactionInfo[];
}

export interface File {
  name: string;
  size: number;
  url: string;
}

// ─── Forward Message ────────────────────────────────────────────────────────

export interface ForwardMessage {
  content: string | CQCode[];
  sender: AccountInfo;
  time: number;
}

// ─── Honor ──────────────────────────────────────────────────────────────────

export type HonorType = "talkative" | "performer" | "legend" | "strong_newbie" | "emotion";

export interface TalkativeMemberInfo extends AccountInfo {
  avatar: string;
  day_count: number;
}

export interface HonoredMemberInfo {
  avatar: string;
  description: string;
}

export interface HonorInfo {
  current_talkative: TalkativeMemberInfo;
  talkative_list: HonoredMemberInfo[];
  performer_list: HonoredMemberInfo[];
  legend_list: HonoredMemberInfo[];
  strong_newbie_list: HonoredMemberInfo[];
  emotion_list: HonoredMemberInfo[];
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

// ─── Media / OCR ────────────────────────────────────────────────────────────

export type RecordFormat = "mp3" | "amr" | "wma" | "m4a" | "spx" | "ogg" | "wav" | "flac";
export type DataDirectory = "image" | "record" | "show" | "bface";

export interface ImageInfo {
  file: string;
  size?: number;
  filename?: string;
  url?: string;
}

export interface RecordInfo {
  file: string;
}

export interface TextDetection {
  text: string;
  confidence: string;
  coordinates: unknown;
}

export interface OcrResult {
  language: string;
  texts: TextDetection[];
}

// ─── Group Notice / Request ─────────────────────────────────────────────────

export interface GroupNotice {
  notice_id: string;
  sender_id: number;
  publish_time: number;
  message: {
    text: string;
    images: GroupNoticeImage[];
  };
}

export interface GroupNoticeImage {
  height: string;
  width: string;
  id: string;
}

export interface GroupRequest extends GroupBase {
  request_id: number;
  invitor_uin: number;
  invitor_nick: string;
  checked: boolean;
  actor: number;
}

export interface InvitedRequest extends GroupRequest {}

export interface JoinRequest extends GroupRequest {
  message: string;
}

export interface GroupSystemMessageInfo {
  invited_requests: InvitedRequest[];
  join_requests: JoinRequest[];
}

export interface AtAllRemain {
  can_at_all: boolean;
  remain_at_all_count_for_group: number;
  remain_at_all_count_for_uin: number;
}

export interface GroupSignedInfo {
  user_id: number;
  nick: string;
  time: number;
  rank: number;
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
  app_name?: string;
  app_version?: string;
  app_full_name?: string;
  protocol_version?: string;
  coolq_edition?: "air" | "pro";
  coolq_directory?: string;
  plugin_version?: string;
  plugin_build_number?: number;
  plugin_build_configuration?: "debug" | "release";
  version?: string;
  go_cqhttp?: boolean;
  runtime_version?: string;
  runtime_os?: string;
  protocol?: string;
}

export interface Statistics {
  packet_received: number;
  packet_sent: number;
  packet_lost: number;
  message_received: number;
  message_sent: number;
  disconnect_times: number;
  lost_times: number;
}

export interface StatusInfo {
  app_initialized: boolean;
  app_enabled: boolean;
  plugins_good: boolean;
  app_good: boolean;
  online: boolean;
  good: boolean;
  stat: Statistics;
}

export interface EssenceMsg {
  message_id: number;
  sender_id: number;
  operator_id: number;
  message: string | CQCode[];
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
  sendMsgAsync(userId: Id, groupId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<void>;
  sendPrivateMsg(userId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<number>;
  sendPrivateMsgAsync(userId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<void>;
  sendGroupMsg(groupId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<number>;
  sendGroupMsgAsync(groupId: Id, message: string | readonly CQCode[], autoEscape?: boolean): Promise<void>;
  sendGroupForwardMsg(groupId: Id, messages: readonly CQCode[]): Promise<number>;
  sendGroupForwardMsgAsync(groupId: Id, messages: readonly CQCode[]): Promise<void>;
  sendPrivateForwardMsg(userId: Id, messages: readonly CQCode[]): Promise<number>;
  sendPrivateForwardMsgAsync(userId: Id, messages: readonly CQCode[]): Promise<void>;
  deleteMsg(messageId: Id): Promise<void>;
  deleteMsgAsync(messageId: Id): Promise<void>;
  setEssenceMsg(messageId: Id): Promise<void>;
  setEssenceMsgAsync(messageId: Id): Promise<void>;
  deleteEssenceMsg(messageId: Id): Promise<void>;
  deleteEssenceMsgAsync(messageId: Id): Promise<void>;
  markMsgAsRead(messageId: Id): Promise<void>;
  markMsgAsReadAsync(messageId: Id): Promise<void>;
  sendLike(userId: Id, times?: number): Promise<void>;
  sendLikeAsync(userId: Id, times?: number): Promise<void>;
  sendGroupSign(groupId: Id): Promise<void>;
  sendGroupSignAsync(groupId: Id): Promise<void>;
  getMsg(messageId: Id): Promise<Message>;
  getForwardMsg(messageId: Id): Promise<ForwardMessage[]>;
  getEssenceMsgList(groupId: Id): Promise<EssenceMsg[]>;
  getWordSlices(content: string): Promise<string[]>;
  ocrImage(image: string): Promise<OcrResult>;
  getGroupMsgHistory(groupId: Id, messageSeq?: number): Promise<{ messages: Message[] }>;
  getFriendMsgHistory(userId: Id, messageSeq?: number, count?: number, reverseOrder?: boolean): Promise<Message[]>;

  // requests
  setFriendAddRequest(flag: string, approve: boolean, remark?: string): Promise<void>;
  setFriendAddRequestAsync(flag: string, approve: boolean, remark?: string): Promise<void>;
  setGroupAddRequest(flag: string, subType: "add" | "invite", approve: boolean, reason?: string): Promise<void>;
  setGroupAddRequestAsync(flag: string, subType: "add" | "invite", approve: boolean, reason?: string): Promise<void>;

  // group operations
  setGroupKick(groupId: Id, userId: Id, rejectAddRequest?: boolean): Promise<void>;
  setGroupKickAsync(groupId: Id, userId: Id, rejectAddRequest?: boolean): Promise<void>;
  setGroupBan(groupId: Id, userId: Id, duration?: number): Promise<void>;
  setGroupBanAsync(groupId: Id, userId: Id, duration?: number): Promise<void>;
  setGroupWholeBan(groupId: Id, enable?: boolean): Promise<void>;
  setGroupWholeBanAsync(groupId: Id, enable?: boolean): Promise<void>;
  setGroupAdmin(groupId: Id, userId: Id, enable?: boolean): Promise<void>;
  setGroupAdminAsync(groupId: Id, userId: Id, enable?: boolean): Promise<void>;
  setGroupAnonymous(groupId: Id, enable?: boolean): Promise<void>;
  setGroupAnonymousAsync(groupId: Id, enable?: boolean): Promise<void>;
  setGroupCard(groupId: Id, userId: Id, card?: string): Promise<void>;
  setGroupCardAsync(groupId: Id, userId: Id, card?: string): Promise<void>;
  setGroupLeave(groupId: Id, isDismiss?: boolean): Promise<void>;
  setGroupLeaveAsync(groupId: Id, isDismiss?: boolean): Promise<void>;
  setGroupSpecialTitle(groupId: Id, userId: Id, specialTitle?: string, duration?: number): Promise<void>;
  setGroupSpecialTitleAsync(groupId: Id, userId: Id, specialTitle?: string, duration?: number): Promise<void>;
  setGroupName(groupId: Id, groupName: string): Promise<void>;
  setGroupNameAsync(groupId: Id, groupName: string): Promise<void>;
  setGroupPortrait(groupId: Id, file: string, cache?: boolean): Promise<void>;
  setGroupPortraitAsync(groupId: Id, file: string, cache?: boolean): Promise<void>;
  setGroupAnonymousBan(groupId: Id, meta: string | AnonymousInfo, duration?: number): Promise<void>;
  setGroupAnonymousBanAsync(groupId: Id, meta: string | AnonymousInfo, duration?: number): Promise<void>;
  getGroupAtAllRemain(groupId: Id): Promise<AtAllRemain>;
  sendGroupNotice(groupId: Id, content: string, image?: string, pinned?: Id, confirmRequired?: Id): Promise<void>;
  sendGroupNoticeAsync(groupId: Id, content: string, image?: string, pinned?: Id, confirmRequired?: Id): Promise<void>;
  getGroupNotice(groupId: Id): Promise<GroupNotice[]>;
  delGroupNotice(groupId: Id, noticeId: Id): Promise<void>;

  // accounts
  getLoginInfo(): Promise<AccountInfo>;
  qidianGetLoginInfo(): Promise<QidianAccountInfo>;
  setQqProfile(nickname: string, company: string, email: string, college: string, personalNote: string): Promise<void>;
  setQqProfileAsync(nickname: string, company: string, email: string, college: string, personalNote: string): Promise<void>;
  setQqAvatar(file: string): Promise<void>;
  setQqAvatarAsync(file: string): Promise<void>;
  setOnlineStatus(status: string, extStatus: string, batteryStatus: string): Promise<void>;
  setOnlineStatusAsync(status: string, extStatus: string, batteryStatus: string): Promise<void>;
  getVipInfo(userId: Id): Promise<VipInfo>;
  getStrangerInfo(userId: Id, noCache?: boolean): Promise<StrangerInfo>;
  getFriendList(): Promise<FriendInfo[]>;
  getUnidirectionalFriendList(): Promise<UnidirectionalFriendInfo[]>;
  deleteFriend(userId: Id): Promise<void>;
  deleteFriendAsync(userId: Id): Promise<void>;
  deleteUnidirectionalFriend(userId: Id): Promise<void>;
  deleteUnidirectionalFriendAsync(userId: Id): Promise<void>;

  // group info
  getGroupInfo(groupId: Id, noCache?: boolean): Promise<GroupInfo>;
  getGroupList(noCache?: boolean): Promise<GroupInfo[]>;
  getGroupMemberInfo(groupId: Id, userId: Id, noCache?: boolean): Promise<GroupMemberInfo>;
  getGroupMemberList(groupId: Id, noCache?: boolean): Promise<GroupMemberInfo[]>;
  getGroupHonorInfo(groupId: Id, type: HonorType): Promise<HonorInfo>;
  getGroupSystemMsg(): Promise<GroupSystemMessageInfo>;

  // files
  getGroupFileSystemInfo(groupId: Id): Promise<GroupFileSystemInfo>;
  getGroupRootFiles(groupId: Id): Promise<GroupFileList>;
  getGroupFilesByFolder(groupId: Id, folderId: string): Promise<GroupFileList>;
  getGroupFileUrl(groupId: Id, fileId: string, busid: number): Promise<string>;
  downloadFile(url: string, headers?: string | readonly string[], threadCount?: number): Promise<string>;
  uploadPrivateFile(userId: Id, file: string, name: string): Promise<void>;
  uploadPrivateFileAsync(userId: Id, file: string, name: string): Promise<void>;
  uploadGroupFile(groupId: Id, file: string, name: string, folder?: string): Promise<void>;
  uploadGroupFileAsync(groupId: Id, file: string, name: string, folder?: string): Promise<void>;
  createGroupFileFolder(groupId: Id, folderId: string, name: string): Promise<void>;
  createGroupFileFolderAsync(groupId: Id, folderId: string, name: string): Promise<void>;
  deleteGroupFolder(groupId: Id, folderId: string): Promise<void>;
  deleteGroupFolderAsync(groupId: Id, folderId: string): Promise<void>;
  deleteGroupFile(groupId: Id, folderId: string, fileId: string, busid: number): Promise<void>;
  deleteGroupFileAsync(groupId: Id, folderId: string, fileId: string, busid: number): Promise<void>;

  // clients / safety
  getOnlineClients(noCache?: boolean): Promise<Device[]>;
  checkUrlSafely(url: string): Promise<SafetyLevel>;
  getModelShow(model: string): Promise<ModelVariant[]>;
  setModelShow(model: string, modelShow: string): Promise<void>;
  setModelShowAsync(model: string, modelShow: string): Promise<void>;

  // credentials
  getCookies(domain?: string): Promise<string>;
  getCsrfToken(): Promise<number>;
  getCredentials(domain?: string): Promise<Credentials>;
  getRecord(file: string, outFormat: RecordFormat, fullPath?: boolean): Promise<RecordInfo>;
  getImage(file: string): Promise<ImageInfo>;
  canSendImage(): Promise<boolean>;
  canSendRecord(): Promise<boolean>;
  reloadEventFilter(): Promise<void>;
  cleanCache(): Promise<void>;

  // reaction
  setMsgEmojiLike(messageId: Id, emojiId: Id, set?: boolean): Promise<void>;
  setMsgEmojiLikeAsync(messageId: Id, emojiId: Id, set?: boolean): Promise<void>;

  // lagrange extensions
  uploadImage(file: string): Promise<string>;
  getPrivateFileUrl(userId: Id, fileId: string, fileHash?: string): Promise<string>;
  moveGroupFile(groupId: Id, fileId: string, parentDirectory: string, targetDirectory: string): Promise<void>;
  moveGroupFileAsync(groupId: Id, fileId: string, parentDirectory: string, targetDirectory: string): Promise<void>;
  deleteGroupFileFolder(groupId: Id, folderId: string): Promise<void>;
  deleteGroupFileFolderAsync(groupId: Id, folderId: string): Promise<void>;
  renameGroupFileFolder(groupId: Id, folderId: string, newFolderName: string): Promise<void>;
  renameGroupFileFolderAsync(groupId: Id, folderId: string, newFolderName: string): Promise<void>;

  // misc
  getGroupSignedList(groupId: Id): Promise<GroupSignedInfo[]>;

  // system
  getVersionInfo(): Promise<VersionInfo>;
  getStatus(): Promise<StatusInfo>;
  setRestart(delay?: number): Promise<void>;
  setRestartAsync(delay?: number): Promise<void>;
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
    if (isAsync) {
      // SAFETY: prototype is a Dict-like object; assigning dynamic methods is the koishi pattern.
      (Internal.prototype as Dict)[`${prop}Async`] = async function (this: Internal, ...args: unknown[]) {
        await this._get(`${name}_async`, Internal.prepareArg(name, params, args));
      };
    }
  }

  static defineExtract(name: string, key: string, ...params: string[]): void {
    const prop = Internal.camelize(name);
    const isAsync = Internal.asyncPrefixes.some((prefix) => prop.startsWith(prefix));
    // SAFETY: prototype is a Dict-like object; assigning dynamic methods is the koishi pattern.
    (Internal.prototype as Dict)[prop] = async function (this: Internal, ...args: unknown[]) {
      const data = await this._get<Dict>(name, Internal.prepareArg(name, params, args));
      return data[key];
    };
    if (isAsync) {
      // SAFETY: prototype is a Dict-like object; assigning dynamic methods is the koishi pattern.
      (Internal.prototype as Dict)[`${prop}Async`] = async function (this: Internal, ...args: unknown[]) {
        await this._get(`${name}_async`, Internal.prepareArg(name, params, args));
      };
    }
  }

  async setGroupAnonymousBan(groupId: string, meta: string | AnonymousInfo, duration?: number): Promise<void> {
    const args: Dict = { group_id: groupId, duration };
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- runtime guard: flag (string) vs anonymous (object) payload selection, koishi parity.
    args[typeof meta === "string" ? "flag" : "anonymous"] = meta;
    await this._get("set_group_anonymous_ban", args);
  }

  async setGroupAnonymousBanAsync(groupId: string, meta: string | AnonymousInfo, duration?: number): Promise<void> {
    const args: Dict = { group_id: groupId, duration };
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- runtime guard: flag (string) vs anonymous (object) payload selection, koishi parity.
    args[typeof meta === "string" ? "flag" : "anonymous"] = meta;
    await this._get("set_group_anonymous_ban_async", args);
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
Internal.defineExtract(".get_word_slices", "slices", "content");
Internal.define("get_group_msg_history", "group_id", "message_seq");
Internal.defineExtract("get_friend_msg_history", "messages", "user_id", "message_seq", "count", "reverseOrder");
Internal.define("set_friend_add_request", "flag", "approve", "remark");
Internal.define("set_group_add_request", "flag", "sub_type", "approve", "reason");
Internal.defineExtract("_get_model_show", "variants", "model");
Internal.define("_set_model_show", "model", "model_show");

// group operations
Internal.define("set_group_kick", "group_id", "user_id", "reject_add_request");
Internal.define("set_group_ban", "group_id", "user_id", "duration");
Internal.define("set_group_whole_ban", "group_id", "enable");
Internal.define("set_group_admin", "group_id", "user_id", "enable");
Internal.define("set_group_anonymous", "group_id", "enable");
Internal.define("set_group_card", "group_id", "user_id", "card");
Internal.define("set_group_leave", "group_id", "is_dismiss");
Internal.define("set_group_special_title", "group_id", "user_id", "special_title", "duration");
Internal.define("set_group_name", "group_id", "group_name");
Internal.define("set_group_portrait", "group_id", "file", "cache");
Internal.define("_send_group_notice", "group_id", "content", "image", "pinned", "confirm_required");
Internal.define("_get_group_notice", "group_id");
Internal.define("_del_group_notice", "group_id", "notice_id");
Internal.define("get_group_at_all_remain", "group_id");

// accounts
Internal.define("get_login_info");
Internal.define("qidian_get_login_info");
Internal.define("set_qq_profile", "nickname", "company", "email", "college", "personal_note");
Internal.define("set_qq_avatar", "file");
Internal.define("set_online_status", "status", "ext_status", "battery_status");
Internal.define("get_stranger_info", "user_id", "no_cache");
Internal.define("_get_vip_info", "user_id");
Internal.define("get_friend_list");
Internal.define("get_unidirectional_friend_list");
Internal.define("delete_friend", "user_id");
Internal.define("delete_unidirectional_friend", "user_id");

// group info
Internal.define("get_group_info", "group_id", "no_cache");
Internal.define("get_group_list", "no_cache");
Internal.define("get_group_member_info", "group_id", "user_id", "no_cache");
Internal.define("get_group_member_list", "group_id");
Internal.define("get_group_honor_info", "group_id", "type");
Internal.define("get_group_system_msg");
Internal.define("get_group_file_system_info", "group_id");
Internal.define("get_group_root_files", "group_id");
Internal.define("get_group_files_by_folder", "group_id", "folder_id");
Internal.define("upload_private_file", "user_id", "file", "name");
Internal.define("upload_group_file", "group_id", "file", "name", "folder");
Internal.define("create_group_file_folder", "group_id", "folder_id", "name");
Internal.define("delete_group_folder", "group_id", "folder_id");
Internal.define("delete_group_file", "group_id", "folder_id", "file_id", "busid");
Internal.defineExtract("get_group_file_url", "url", "group_id", "file_id", "busid");
Internal.defineExtract("download_file", "file", "url", "headers", "thread_count");
Internal.defineExtract("get_online_clients", "clients", "no_cache");
Internal.defineExtract("check_url_safely", "level", "url");
Internal.define("get_group_signed_list", "group_id");

// credentials / media
Internal.defineExtract("get_cookies", "cookies", "domain");
Internal.defineExtract("get_csrf_token", "token");
Internal.define("get_credentials", "domain");
Internal.define("get_record", "file", "out_format", "full_path");
Internal.define("get_image", "file");
Internal.defineExtract("can_send_image", "yes");
Internal.defineExtract("can_send_record", "yes");
Internal.define("reload_event_filter");
Internal.define("clean_cache");

// system
Internal.define("get_version_info");
Internal.define("get_status");
Internal.define("set_restart", "delay");

// lagrange extensions
Internal.define("upload_image", "file");
Internal.defineExtract("get_private_file_url", "url", "user_id", "file_id", "file_hash");
Internal.define("move_group_file", "group_id", "file_id", "parent_directory", "target_directory");
Internal.define("delete_group_file_folder", "group_id", "folder_id");
Internal.define("rename_group_file_folder", "group_id", "folder_id", "new_folder_name");

// reaction
Internal.define("set_msg_emoji_like", "message_id", "emoji_id", "set");
