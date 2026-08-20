import { type Context, type Dict, useStorage } from "@cordisjs/client";
import { computed } from "vue";

import type { Message, RequestPayload } from "../src/shared";

declare module "@cordisjs/client" {
  interface ActionContext {
    "sandbox.message": Message;
  }
}

declare module "cordis" {
  interface Events {
    "sandbox/message"(body: Message): void;
    "sandbox/request"(body: RequestPayload): void;
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

export interface SandboxConfig {
  /** Virtual platform id — one per browser, persisted in local storage. */
  platform: string;
  /** Currently selected sandbox user. */
  user: string;
  /** Cursor into `words`, used to name the next user. */
  index: number;
  /** Chat log per channel id. */
  messages: Dict<Message[]>;
  panelType: keyof typeof panelTypes;
}

export const config = useStorage<SandboxConfig>("sandbox", 1.2, () => ({
  platform: "sandbox:" + Math.random().toString(36).slice(2),
  user: "",
  index: 0,
  messages: {},
  panelType: "private",
}));

export const channel = computed(() => {
  if (config.value.panelType === "guild") return GUILD_CHANNEL;
  return "@" + config.value.user;
});

export const users = computed(() => {
  return Object.keys(config.value.messages)
    .filter((key) => key.startsWith("@"))
    .map((key) => key.slice(1));
});

export function send(ctx: Context, type: string, body: unknown) {
  const socket = ctx.client.socket.value;
  if (!socket) return console.warn("[sandbox] dropping %s: socket not connected", type);
  socket.send(JSON.stringify({ type, body }));
}

/**
 * The sandbox page *is* the platform, so it answers the Satori read APIs the
 * harness would normally issue against a real server.
 */
type ApiHandler = (data: Record<string, string>) => unknown;

const api: Dict<ApiHandler> = {
  deleteMessage({ messageId, channelId }) {
    const messages = config.value.messages[channelId];
    if (!messages) return;
    config.value.messages[channelId] = messages.filter((message) => message.id !== messageId);
  },
  getMessage({ messageId, channelId }) {
    const message = config.value.messages[channelId]?.find((item) => item.id === messageId);
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

/** Wire the page to the harness: inbound bubbles and inbound API calls. */
export function connectSandbox(ctx: Context) {
  ctx.on("sandbox/message", (message) => {
    if (message.platform !== config.value.platform) return;
    (config.value.messages[message.channel] ||= []).push(message);
  });

  ctx.on("sandbox/request", ({ method, data, nonce }) => {
    const handler = api[method];
    if (!handler) console.warn("[sandbox] unimplemented api: %s", method);
    send(ctx, "sandbox/response", {
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
