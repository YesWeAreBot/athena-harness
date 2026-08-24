import type { Element } from "@cordisjs/element";

export interface SendOptions {
  /** Link preview generation. */
  linkPreview?: boolean;
}

export interface User {
  id: string;
  name?: string;
  avatar?: string;
}

export interface GuildMember {
  user?: User;
  nick?: string;
  roles?: Array<{ id: string; name?: string }>;
}

export interface Channel {
  id: string;
  type: Channel.Type;
  name?: string;
}

export namespace Channel {
  export const Type = {
    TEXT: 0,
    DIRECT: 1,
    VOICE: 2,
    CATEGORY: 3,
  } as const;

  export type Type = (typeof Type)[keyof typeof Type];
}

export interface Guild {
  id: string;
  name?: string;
  avatar?: string;
}

export interface Message {
  id: string;
  content?: string;
  elements?: Element[];
  channel?: Channel;
  guild?: Guild;
  user?: User;
  member?: GuildMember;
  timestamp?: number;
  quote?: Message;
}

export interface List<T = unknown> {
  data: T[];
  next?: string;
}
