import { type Context, type Dict, useStorage } from "@cordisjs/client";
import { computed } from "vue";

import type { JsonValue, LifeListPayload, Message, RequestPayload } from "../src/shared";

declare module "@cordisjs/client" {
  interface ActionContext {
    "sandbox.message": Message;
  }
}

declare module "cordis" {
  interface Events {
    "sandbox/message"(body: Message): void;
    "sandbox/request"(body: RequestPayload): void;
    "sandbox/life-list"(body: LifeListPayload): void;
  }
}

/** `Universal.Channel.Type` values, inlined so the browser bundle stays lean. */
const CHANNEL_TEXT = 0;
const CHANNEL_DIRECT = 1;

/** The guild channel every sandbox user shares. */
const GUILD_CHANNEL = "#";

export const panelTypes = {
  private: "私聊模式",
  guild: "群聊模式",
};

export interface LifeEntry {
  id: string;
  name: string;
  description?: string;
}

export interface SandboxConfig {
  /** Virtual platform id — one per browser, persisted in local storage. */
  platform: string;
  /** Currently selected sandbox user. */
  user: string;
  /** Cursor into `words`, used to name the next user. */
  index: number;
  /** Currently selected Life id. */
  selectedLife: string;
  /** Available Lives from Hub. */
  lives: LifeEntry[];
  /**
   * Chat log keyed by `${lifeId}/${channel}`.
   * Falls back to just `channel` when lifeId is empty (legacy single-life).
   */
  messages: Dict<Message[]>;
  panelType: keyof typeof panelTypes;
}

export const config = useStorage<SandboxConfig>("sandbox", 1.3, () => ({
  platform: `sandbox:${Math.random().toString(36).slice(2)}`,
  user: "",
  index: 0,
  selectedLife: "",
  lives: [],
  messages: {},
  panelType: "private",
}));

/** Composite key for message storage: includes lifeId when available. */
export function messageKey(lifeId: string, channelId: string): string {
  return lifeId ? `${lifeId}/${channelId}` : channelId;
}

export const channel = computed(() => {
  if (config.value.panelType === "guild") return GUILD_CHANNEL;
  return `@${config.value.user}`;
});

/** Current message key (lifeId + channel). */
export const currentMessageKey = computed(() => {
  return messageKey(config.value.selectedLife, channel.value);
});

export const users = computed(() => {
  const prefix = config.value.selectedLife ? `${config.value.selectedLife}/@` : "@";
  return Object.keys(config.value.messages)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
});

export function send(ctx: Context, type: string, body: JsonValue): void {
  const socket = ctx.client.socket.value;
  if (!socket) {
    console.warn("[sandbox] dropping %s: socket not connected", type);
    return;
  }
  socket.send(JSON.stringify({ type, body }));
}

/**
 * The sandbox page *is* the platform, so it answers the Satori read APIs the
 * harness would normally issue against a real server.
 */
type ApiHandler = (data: Record<string, string>) => JsonValue | undefined;

const api: Dict<ApiHandler> = {
  deleteMessage({ messageId, channelId }) {
    const key = messageKey(config.value.selectedLife, channelId);
    const messages = config.value.messages[key];
    if (!messages) return;
    config.value.messages[key] = messages.filter((message) => message.id !== messageId);
  },
  getMessage({ messageId, channelId }) {
    const key = messageKey(config.value.selectedLife, channelId);
    const message = config.value.messages[key]?.find((item) => item.id === messageId);
    if (!message) return;
    return {
      id: message.id,
      content: message.content,
      channel: { id: message.channel },
      user: { id: message.user, name: message.user },
    };
  },
  getChannel({ channelId }) {
    return { id: channelId, type: channelId.startsWith("@") ? CHANNEL_DIRECT : CHANNEL_TEXT };
  },
  getChannelList() {
    return { data: [{ id: GUILD_CHANNEL, type: CHANNEL_TEXT }] };
  },
  getGuild({ guildId }) {
    return { id: guildId };
  },
  getGuildList() {
    return { data: [{ id: GUILD_CHANNEL }] };
  },
  getGuildMember({ userId }) {
    return { user: { id: userId, name: userId } };
  },
  getGuildMemberList() {
    return { data: users.value.map((name) => ({ user: { id: name, name } })) };
  },
};

/** Wire the page to the harness: inbound bubbles, life-list, and inbound API calls. */
export function connectSandbox(ctx: Context) {
  ctx.on("sandbox/message", (message) => {
    if (message.platform !== config.value.platform) return;
    const key = messageKey(message.lifeId || "", message.channel);
    (config.value.messages[key] ||= []).push(message);
  });

  ctx.on("sandbox/life-list", (payload) => {
    config.value.lives = payload.lives;
    // Auto-select first life if none selected or selected was removed
    if ((!config.value.selectedLife || !payload.lives.some((l) => l.id === config.value.selectedLife)) && payload.lives.length > 0) {
      config.value.selectedLife = payload.lives[0].id;
    }
  });

  ctx.on("sandbox/request", ({ lifeId, method, data, nonce }) => {
    const handler = api[method];
    if (!handler) console.warn("[sandbox] unimplemented api: %s", method);
    send(ctx, "sandbox/response", {
      lifeId: lifeId || config.value.selectedLife,
      platform: config.value.platform,
      nonce,
      data: handler?.(data),
    });
  });
}

export const words = [
  "Alice",
  "Bob",
  "Carol",
  "Dave",
  "Eve",
  "Frank",
  "Grace",
  "Hank",
  "Ivy",
  "Jack",
  "Kathy",
  "Lily",
  "Mandy",
  "Nancy",
  "Oscar",
  "Peggy",
  "Quinn",
  "Randy",
  "Sandy",
  "Toby",
  "Uma",
  "Vicky",
  "Wendy",
  "Xander",
  "Yvonne",
  "Zoe",
];

/** How many sandbox users may exist at once. */
export const MAX_USERS = 10;
