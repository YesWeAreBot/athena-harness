import type { Element } from "@cordisjs/element";

// ─── Pagination ─────────────────────────────────────────────────────────────

export interface List<T = any> {
  data: T[];
  next?: string;
}

export interface BidiList<T = any> extends List<T> {
  prev?: string;
}

export type Direction = "before" | "after" | "around";
export type Order = "asc" | "desc";

// ─── Send Options ───────────────────────────────────────────────────────────

export interface SendOptions {
  linkPreview?: boolean;
}

// ─── User ───────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  name?: string;
  nick?: string;
  avatar?: string;
  isBot?: boolean;
}

// ─── Channel ────────────────────────────────────────────────────────────────

export interface Channel {
  id: string;
  type: Channel.Type;
  name?: string;
  parentId?: string;
}

export namespace Channel {
  export const enum Type {
    TEXT = 0,
    DIRECT = 1,
    CATEGORY = 2,
    VOICE = 3,
  }
}

// ─── Guild ──────────────────────────────────────────────────────────────────

export interface Guild {
  id: string;
  name?: string;
  avatar?: string;
}

// ─── Guild Role ─────────────────────────────────────────────────────────────

export interface GuildRole {
  id: string;
  name?: string;
  color?: number;
  position?: number;
}

// ─── Guild Member ───────────────────────────────────────────────────────────

export interface GuildMember {
  user?: User;
  name?: string;
  nick?: string;
  avatar?: string;
  roles?: GuildRole[];
  joinedAt?: number;
}

// ─── Friend ─────────────────────────────────────────────────────────────────

export interface Friend {
  user?: User;
  nick?: string;
}

// ─── Message ────────────────────────────────────────────────────────────────

export interface Message {
  id?: string;
  channel?: Channel;
  guild?: Guild;
  user?: User;
  member?: GuildMember;
  content?: string;
  elements?: Element[];
  timestamp?: number;
  quote?: Message;
  createdAt?: number;
  updatedAt?: number;
}

// ─── Login ──────────────────────────────────────────────────────────────────

export interface Login {
  user?: User;
  platform?: string;
  status: LoginStatus;
  features: string[];
}

export const enum LoginStatus {
  OFFLINE = 0,
  ONLINE = 1,
  CONNECT = 2,
  DISCONNECT = 3,
  RECONNECT = 4,
}
