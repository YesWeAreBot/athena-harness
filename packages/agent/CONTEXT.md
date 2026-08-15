# @athena/agent — Context

## Vocabulary

**Agent** — the public interface. Holds `session`, `model`, `maxSteps`, `agentKey`, and
the three input methods. Does not contain execution logic.

**AgentKey** — `readonly agentKey: symbol` on every Agent. Used to scope tool and prompt
registrations to this specific agent.

**Inbox** — two-slot input buffer: `next-turn` and `next-step`. Slots have no capacity
limit; rate limiting is the caller's responsibility.

**followup(content)** — append to `next-turn` slot, then wake the loop. Triggers a full
new Turn. Do not call it send or push.

**steer(content)** — append to `next-step` slot, then wake the loop. The content is claimed
at the start of the next Step within the current Turn. Do not call it redirect or interrupt.

**inject(content)** — append to `next-step` slot without waking. Passive environment
accumulation. Do not call it append or observe.

**claim** — the atomic operation by which the loop drains a slot at Turn/Step start. Returns
all buffered contents and leaves the slot empty. Do not call it dequeue or consume.

**AgentFactory** — the replacement seam for the Agent Loop (spec K3). Declared in this
package; implemented by `@athena/agent-loop`. Register via `ctx.agents.setFactory()`.

**AgentRegistry** (`ctx.agents`) — tracks live agents; delegates create/resume to the
registered AgentFactory; wraps dispose to remove from registry.
