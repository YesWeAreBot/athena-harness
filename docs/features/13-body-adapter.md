# 13 - Body Adapter

## What It Gives You

`BodyAdapter` is the bridge between an existing platform adapter (OneBot, Satori, Discord, etc.) and a
Life Body. It intentionally does not implement Mode behavior.

```ts
interface BodyAdapter {
  id: string;
  name?: string;
  senses?: Sense[];
  actuators?: Actuator[];
  start?(context: BodyAdapterContext): Awaitable<void>;
  stop?(): Awaitable<void>;
}
```

## Usage

```ts
const dispose = await ctx.bodies.registerAdapter({
  id: "onebot",
  name: "OneBot",
  senses: [{ id: "message", kind: "chat" }],
  actuators: [
    {
      id: "send",
      kind: "chat",
      act: async (action) => {
        /* call the platform send API */
      },
    },
  ],
  start: async ({ body }) => {
    /* subscribe to platform events and dispatch PerceptEvents */
  },
  stop: async () => {
    /* unsubscribe and close connections */
  },
});
```

## Relationship To Koishi Adapters

`koishi-plugin-adapter-onebot` shows the shape that should be bridged:

- Adapter Session/Event → `ctx.bodies.dispatch(bodyId, kind, data)`
- Adapter Bot API → `Actuator.act(action)`
- Adapter account/channel/group state → `Body.state`

The OneBot implementation itself remains a Koishi adapter. Athena Runtime only consumes it through
`BodyAdapter`, so Mode developers see `PerceptEvent` and `Actuator`, not OneBot internals.

## OneBot Actions Become Actuators

OneBot capabilities such as 拍一拍, reactions, group ban, and message sending are all mapped to
`Actuator` entries:

| OneBot action                 | Actuator                                                                    |
| ----------------------------- | --------------------------------------------------------------------------- |
| `friend_poke` / `group_poke`  | `{ id: "poke", kind: "poke", act: ({ userId }) => ... }`                    |
| `set_msg_emoji_like`          | `{ id: "react", kind: "react", act: ({ messageId, emoji }) => ... }`        |
| `set_group_ban`               | `{ id: "group-ban", kind: "group-ban", act: ({ userId, minutes }) => ... }` |
| `send_msg` / `send_group_msg` | `{ id: "send", kind: "chat", act: ({ channelId, content }) => ... }`        |

The exact actuator id/kind is chosen by the BodyAdapter. athena-runtime does not define a closed list
of OneBot actions.

## Events Become Percepts

Every Body event is a `PerceptEvent`. `kind` is an open string chosen by the BodyAdapter:

| Source                | PerceptEvent.kind | data                               |
| --------------------- | ----------------- | ---------------------------------- |
| OneBot message        | `message-created` | sender, channel, content, elements |
| OneBot 拍一拍         | `notice.poke`     | userId, targetId                   |
| Minecraft damage      | `entity.damage`   | entity, amount, source             |
| Bilibili live message | `live.message`    | room, sender, content              |
| World tick            | `world.tingle`    | worldTime, interval                |

The BodyAdapter emits these through `ctx.bodies.dispatch(bodyId, kind, data)`. Life routes the
`PerceptEvent` to its active Mode; Mode may filter by `ModePerceptInterest` and consume it in
`handle(event)`.

## Who Provides And Registers Events

Events are provided by `BodyAdapter`, not by athena-runtime and not by Mode:

1. The adapter registers itself with `ctx.bodies.registerAdapter(adapter)`.
2. In `adapter.start()`, it subscribes to the platform event source.
3. When a platform event arrives, it calls `ctx.bodies.dispatch(bodyId, kind, data)`.
4. `PerceptEvent.kind` is open and needs no pre-registration.
5. `LifeRegistry` routes the event to the Life's active Mode.
6. Mode may declare `ModePerceptInterest`, but it does not own or register the event.
