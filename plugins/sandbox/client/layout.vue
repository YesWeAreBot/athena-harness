<template>
  <k-layout class="page-sandbox" menu="sandbox.page">
    <aside class="page-sidebar">
      <div class="card-header k-tab-menu-item" @click="createUser">添加用户</div>
      <div class="user-container">
        <el-scrollbar>
          <k-tab-group :data="userMap" v-model="config.user" #="{ name }">
            <div class="avatar">{{ name[0] }}</div>
            <div class="nick">{{ name }}</div>
            <div class="close" @click.stop="removeUser(name)">
              <k-icon name="times-full"></k-icon>
            </div>
          </k-tab-group>
        </el-scrollbar>
      </div>
    </aside>

    <div class="content-area">
      <k-tab-bar :tabs="panelTabs" :active="config.panelType" @select="selectPanel" />
      <div class="content-body">
        <k-empty v-if="!users.length">
          <div>点击「添加用户」开始体验</div>
        </k-empty>
        <div class="chat-panel" v-else :key="channel">
          <virtual-list :data="messages" #="item" pinned>
            <chat-message :data="item"></chat-message>
          </virtual-list>
          <div class="card-footer">
            <div class="quote" v-if="quote">
              <span class="left">正在回复 @{{ quote.user }}</span>
              <k-icon name="times-full" @click="quote = undefined"></k-icon>
            </div>
            <chat-input v-model="input" @send="sendMessage" @keydown="onKeydown" placeholder="发送消息到沙盒"></chat-input>
          </div>
        </div>
      </div>
    </div>
  </k-layout>
</template>

<script lang="ts" setup>
import { message, useContext } from "@cordisjs/client";
import { unescape } from "@satorijs/element";
import { computed, ref } from "vue";

import type { Message } from "../src/shared";
import ChatInput from "./input.vue";
import ChatMessage from "./message.vue";
import { channel, config, MAX_USERS, panelTypes, send, users, words } from "./utils";

const ctx = useContext();

const input = ref("");
const offset = ref(0);
const quote = ref<Message>();

const messages = computed(() => config.value.messages[channel.value] ?? []);

const userMap = computed(() => {
  return Object.fromEntries(users.value.map((name) => [name, { name }]));
});

const panelTabs = computed(() => {
  return Object.entries(panelTypes).map(([id, label]) => ({ id, label }));
});

function selectPanel(id: string) {
  config.value.panelType = id as keyof typeof panelTypes;
}

function createUser() {
  if (users.value.length >= MAX_USERS) {
    return message.error("可创建的用户数量已达上限。");
  }
  let name: string;
  do {
    name = words[config.value.index++];
    config.value.index %= MAX_USERS;
  } while (users.value.includes(name));
  config.value.user = name;
  config.value.messages["@" + name] = [];
}

function removeUser(name: string) {
  const index = users.value.indexOf(name);
  delete config.value.messages["@" + name];
  if (config.value.user === name) {
    config.value.user = users.value[index] || "";
  }
}

/** Recall the user's own previous inputs with the arrow keys. */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  const own = messages.value.filter((item) => item.user === config.value.user);
  const cursor = own.length - offset.value;
  if (event.key === "ArrowUp") {
    if (!own[cursor - 1]) return;
    offset.value++;
    input.value = unescape(own[cursor - 1].content);
    return;
  }
  if (own[cursor + 1]) {
    offset.value--;
    input.value = unescape(own[cursor + 1].content);
  } else if (offset.value) {
    offset.value = 0;
    input.value = "";
  }
}

function sendMessage(content: string) {
  offset.value = 0;
  send(ctx, "sandbox/send-message", {
    platform: config.value.platform,
    user: config.value.user,
    channel: channel.value,
    content,
    quote: quote.value,
  });
  quote.value = undefined;
}

function deleteMessage(data: Message) {
  send(ctx, "sandbox/delete-message", {
    platform: data.platform,
    user: data.user,
    channel: data.channel,
    messageId: data.id,
  });
  const list = config.value.messages[data.channel];
  if (list) {
    config.value.messages[data.channel] = list.filter((item) => item.id !== data.id);
  }
}

ctx.client.action.action("sandbox.message.delete", {
  action: ({ sandbox }) => deleteMessage(sandbox.message),
});

ctx.client.action.action("sandbox.message.quote", {
  action: ({ sandbox }) => (quote.value = sandbox.message),
});

ctx.client.action.action("sandbox.page.clear", {
  action: () => (config.value.messages[channel.value] = []),
});
</script>

<style lang="scss">
.page-sandbox {
  --avatar-size: 2.5rem;

  .page-sidebar {
    display: flex;
    flex-direction: column;
  }

  .chat-panel {
    flex: 1 1 0;
    min-height: 0;
    display: flex;
    flex-direction: column;

    > .virtual-list,
    > :deep(.el-scrollbar) {
      flex: 1 1 0;
      min-height: 0;
    }
  }

  .avatar {
    border-radius: 100%;
    background-color: var(--primary);
    transition: 0.3s ease;
    width: var(--avatar-size);
    height: var(--avatar-size);
    line-height: var(--avatar-size);
    font-size: 1.25rem;
    text-align: center;
    font-weight: 400;
    color: #fff;
    user-select: none;
  }

  .card-header {
    text-align: center;
    font-weight: bold;
    font-size: 1.15rem;
    padding: 1rem 0;
    border-bottom: 1px solid var(--k-color-divider);
    cursor: pointer;
  }

  .card-footer {
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--k-color-divider);

    .quote {
      opacity: 0.5;
      font-size: 14px;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;

      .k-icon {
        cursor: pointer;
      }
    }
  }

  .user-container {
    flex: 1 1 0;
    min-height: 0;
    overflow-y: auto;
  }

  .k-tab-item {
    padding: 0.75rem 1.5rem;
    display: flex;
    border-bottom: 1px solid var(--k-color-divider);

    > .nick {
      line-height: 2.5rem;
      margin-left: 1.25rem;
      font-weight: 500;
      flex-grow: 1;
    }

    > .close {
      opacity: 0;
      display: flex;
      flex-direction: column;
      justify-content: center;
      transition: opacity 0.3s ease;
      color: var(--fg1);
    }

    &:hover > .close {
      opacity: 0.5;
      &:hover {
        opacity: 1;
      }
    }
  }
}
</style>
