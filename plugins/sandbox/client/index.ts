import type { Context } from "@cordisjs/client";

import "./icons";
import Sandbox from "./layout.vue";
import { connectSandbox } from "./utils";

export default (ctx: Context) => {
  connectSandbox(ctx);

  ctx.client.router.page({
    name: "沙盒",
    path: "/sandbox",
    icon: "activity:flask",
    order: 300,
    component: Sandbox,
  });

  ctx.client.action.menu("sandbox.page", [
    {
      id: ".clear",
      label: "清空聊天记录",
      icon: "trash",
    },
  ]);

  ctx.client.action.menu("sandbox.message", [
    {
      id: ".delete",
      label: "删除消息",
    },
    {
      id: ".quote",
      label: "引用回复",
    },
  ]);
};
