# Mode Capability Scope

## Boundary

Athena Runtime 不把产品事件写死到内核。感知事件由 Body/Adapter 产生，Mode 只消费：

> 如果你更熟悉 Koishi 的 Event/Adapter/Bot/Command，先看 [Glossary for Koishi Developers](./glossary.md)。

```text
Body
  ├─ Senses      → 产生 PerceptEvent
  ├─ Actuators   → 接受 act(bodyId, actuatorId, action)
  └─ Body State
        │
        ▼
LifeRegistry → 按 Life 已 attach 的 Body 路由
        │
        ▼
LifeHandle.activeMode.handle(percept)
        │
        ▼
Mode 通过 ModeContext.bodies.act(...) 使用 Actuator
```

`PerceptEvent.kind` 和 `Actuator.kind` 是开放字符串，由 Body/Adapter 定义。`ModeCapabilities` 只声明 Mode 的“兴趣范围”，不定义事件或 Actuator。

## ModeCapabilities

```ts
interface ModeCapabilities {
  driver: "finite-tool-loop" | "continuous-mailbox" | "narrative-decision" | "custom"
  percepts: ModePerceptInterest[]
  actuators: ModeActuatorInterest[]
  scheduling: ModeSchedulingKind[]
  memory: ModeMemoryKind[]
  productState: ModeProductStateKind[]
  bodies?: string[]
}
```

- `percepts`：Mode 关心的 Body/Percept 组合，字段为 `body`、`kind`。
- `actuators`：Mode 可能调用的 Body/Actuator 组合，字段为 `body`、`actuator`、`kind`。
- `scheduling`：Mode 使用的驱动方式，如 `event`、`timer`、`tingle`、`due-intent`、`sweep`、`auto-advance`。
- `memory`：Mode 依赖的记忆层，如 `conversation`、`life-stream`、`world-status`、`facts`、`story-facts`、`embedding`。
- `productState`：Mode 拥有的产品状态，如 `channel`、`world`、`story`。

这些声明用于发现、文档、WebUI 和未来热加载校验，不替代 `ModeHandle.handle()` 与 `ModeContext.bodies.act()` 的实际执行边界。

## 三个历史产品的能力范围

| 维度 | Chat / YesImBot | World | Interlude |
| --- | --- | --- | --- |
| driver | finite-tool-loop | continuous-mailbox | narrative-decision |
| percepts | message-created 等 IM Body 事件 | phone-notification、world-event、tingle | message-created、story-intent、sweep/due |
| actuators | chat-send、platform-ops、workspace | world-act、phone-app、computer、chat-send | story-state、chat-send、web-observation |
| scheduling | event、timer | timer、tingle、wait/wake | debounce、due-intent、sweep、auto-advance |
| memory | conversation、facts、embedding | world-status、facts、life-stream | story-facts、facts、embedding |
| productState | channel | world | story |

具体事件名和 Actuator 名由对应 Body/Mode 插件声明，不进入 `athena-runtime` 的封闭枚举。

## 生命周期

### Mode

- `ModeRegistry.register(mode)` 是 Cordis effect；定义被卸载时，会先 dispose 该定义创建的所有实例，再删除定义。
- `ModeRegistry.create(name, config, context?)` 返回运行时 `ModeHandle`，包含 `id`、`name`、`disposed`、可选 `start/stop/handle/dispose`。
- `ModeHandle.dispose()` 幂等；销毁后触发 `mode/disposed`。
- 禁止向 Life 安装已 disposed 的 Mode。

### Life

- `LifeHandle.setMode(next)` 先停止/销毁旧 Mode，再安装并启动新 Mode。
- 新 Mode 的 `start()` 失败时，Life 销毁该 Mode 并清除 activeMode，不保留半启动状态。
- `LifeHandle.dispatchPercept(event)` 只在存在未 disposed 的 activeMode 时调用 `handle`。
- `LifeHandle.dispose()` 停止并销毁 activeMode，移除 Life，移除 Session。

### Body

- `BodyRegistry.register(body)` 是 Cordis effect；Body 被卸载时触发 `body/disposed`。
- `BodyRegistry.act(bodyId, actuatorId, action)` 按 Body 注册的 Actuator 执行动作。
- LifeRegistry 监听 `mode/disposed` 和 `body/disposed`，自动清理 Life 的 activeMode 和已 attach 的 Body id，保证插件热卸载后不残留引用。
