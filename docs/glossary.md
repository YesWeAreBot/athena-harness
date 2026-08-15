# Glossary for Koishi Developers

Athena Harness 使用 Life/Body/Percept/Actuator/Mode 这些词，并不是为了替换 Koishi 的 Event/Adapter，而是把 Koishi 开发者已经熟悉的概念拆成更通用的“感知/执行/身份/生活方式”边界。

## Quick Mapping

| Koishi / YesImBot 旧概念          | Athena Harness 新概念     | 说明                                                |
| --------------------------------- | ------------------------- | --------------------------------------------------- |
| `message-created` Event           | `PerceptEvent`            | Body 产生的感知事件，`kind` 是开放字符串            |
| OneBot / Satori / Discord Adapter | `Body`                    | 一个 Body = Senses + Actuators + Body State         |
| Bot / 机器人身份                  | `Life`                    | 持久身份，拥有 Session 和当前 Mode                  |
| 插件行为 / 对话模式               | `Mode`                    | Life 当前选择的生活方式，不是事件定义者             |
| `bot.sendMessage()` / 群管 API    | `Actuator`                | Body 暴露给 Life/Mode 的执行能力                    |
| Event payload / 消息内容          | `PerceptEvent.data`       | 结构化感知数据，不预渲染为聊天消息                  |
| Channel / Group / User            | Body State / Life Context | 具体平台概念留在 Body，不进入内核                   |
| Middleware / Event 路由           | LifeRegistry 路由         | 按 Life attach 的 Body 将 Percept 投递给 activeMode |
| 会话/聊天记录                     | Session Log               | 低层执行事实，未来可派生 Life Memory                |

## Why

- Adapter 强调“传输协议”，Body 强调“这个生命如何感知和行动”。
- Event 强调“一次平台回调”，PerceptEvent 强调“环境状态进入生命的感知”。
- Bot 强调“一个机器人账号”，Life 强调“一个持续存在的身份，可以跨账号、跨 Body、跨 Mode”。
- Command/API 强调“平台能力”，Actuator 强调“生命可执行的动作边界”。

## Example

```text
OneBot Adapter
  → 变成 OneBot Body
  → Senses 产生 message-created / notice-poke 等 PerceptEvent
  → Actuators 提供 send-message / recall-message / group-ban
  → Life 挂上这个 Body
  → Chat Mode 收到 PerceptEvent，通过 ctx.bodies.act() 调用 Actuator
```

具体事件名和 Actuator 名仍由 OneBot/Satori 等 Body 实现定义；athena-runtime 不维护封闭枚举。
