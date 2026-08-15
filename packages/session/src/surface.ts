import type { ModelMessage } from "ai";

import { InvalidReplaceRangeError } from "./errors.js";
import type { ProjectorMap, SessionEvent, SurfaceNode } from "./types.js";

export class Surface {
  private _nodes: SurfaceNode[] = [];

  get nodes(): readonly SurfaceNode[] {
    return this._nodes;
  }

  /** Called by Session.append when surfaceOp === 'append'. */
  appendNode(seq: number): void {
    this._nodes.push({ seq });
  }

  /**
   * Called by Session.append when surfaceOp === { replace: { start, end } }.
   * Replaces the half-open range [start, end) in nodes with a single node
   * whose seq is the new event's seq.
   * Throws InvalidReplaceRangeError if the range is out of bounds.
   */
  replaceNodes(seq: number, start: number, end: number): void {
    if (start < 0 || end > this._nodes.length || start >= end) {
      throw new InvalidReplaceRangeError(start, end, this._nodes.length);
    }
    this._nodes.splice(start, end - start, { seq });
  }

  /**
   * Derive a ModelMessage[] from the current node list.
   * For each node, looks up the projector in scoped map (agentKey) first,
   * then global map. Returns null projector result → omit from output.
   * Throws if no projector is registered for a node's event type.
   */
  deriveMessages(events: ReadonlyMap<number, SessionEvent>, projectors: ProjectorMap, agentKey?: symbol): ModelMessage[] {
    const messages: ModelMessage[] = [];
    for (const node of this._nodes) {
      const event = events.get(node.seq);
      if (!event) {
        throw new Error(`Surface references missing event seq=${node.seq}`);
      }
      const projector = (agentKey && projectors.scoped.get(agentKey)?.get(event.type)) ?? projectors.global.get(event.type);
      if (!projector) continue; // no projector = not model-visible
      const msg = projector(event);
      if (msg !== null) messages.push(msg);
    }
    return messages;
  }
}
