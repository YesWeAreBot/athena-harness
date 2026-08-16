import type { AssistantModelMessage, ModelMessage, ToolModelMessage, UserContent, UserModelMessage } from "ai";
import { Service } from "cordis";
import type { Context } from "cordis";

import type { Session } from "./session/index.js";
import type { SessionEvent } from "./session/types.js";

export type UserProjector<T = unknown> = (event: SessionEvent<T>) => UserContent | undefined;

interface AssistantEventData {
  message: AssistantModelMessage;
}

interface ToolResultEventData {
  message: ToolModelMessage;
}

interface UserEventData {
  content: UserContent;
}

interface ContextSnapshotData {
  rendered: string;
}

export class ModelSurface extends Service {
  static provide = "modelSurface";

  private userProjectors = new Map<string, UserProjector>();

  private scopedUserProjectors = new Map<symbol, Map<string, UserProjector>>();

  constructor(ctx: Context) {
    super(ctx, "modelSurface");
  }

  registerUserProjector(type: string, projector: UserProjector, scope?: symbol): () => Promise<void> {
    if (scope) {
      const layer = this.scopedUserProjectors.get(scope) ?? new Map();
      if (layer.has(type)) {
        throw new Error(`User projector already registered in scope: ${type}`);
      }
      layer.set(type, projector);
      this.scopedUserProjectors.set(scope, layer);
      return this.ctx.effect(() => () => {
        layer.delete(type);
      });
    }

    if (this.userProjectors.has(type)) {
      throw new Error(`User projector already registered: ${type}`);
    }
    this.userProjectors.set(type, projector);
    return this.ctx.effect(() => () => {
      this.userProjectors.delete(type);
    });
  }

  hasUserProjector(type: string, scope?: symbol): boolean {
    return (scope && this.scopedUserProjectors.get(scope)?.has(type)) || this.userProjectors.has(type);
  }

  deriveMessages(session: Session, scope?: symbol): ModelMessage[] {
    const messages: ModelMessage[] = [];
    for (const node of session.surface.snapshot.nodes) {
      const event = session.getEvent(node.seq);
      if (!event) {
        throw new Error(`Surface references missing event: ${node.seq}`);
      }
      const message = this.project(event, scope);
      if (message) messages.push(message);
    }
    return messages;
  }

  private project(event: SessionEvent, scope?: symbol): ModelMessage | undefined {
    if (event.type === "user/message") {
      return this.projectUser(event);
    }
    if (event.type === "assistant/message") {
      return (event.data as AssistantEventData).message;
    }
    if (event.type === "tool/result") {
      return (event.data as ToolResultEventData).message;
    }
    if (event.type === "context/snapshot") {
      return {
        role: "user",
        content: (event.data as ContextSnapshotData).rendered,
      };
    }
    return this.projectCustom(event, scope);
  }

  private projectUser(event: SessionEvent): UserModelMessage | undefined {
    const content = (event.data as UserEventData).content;
    return { role: "user", content };
  }

  private projectCustom(event: SessionEvent, scope?: symbol): ModelMessage | undefined {
    const projector = (scope && this.scopedUserProjectors.get(scope)?.get(event.type)) ?? this.userProjectors.get(event.type);
    if (!projector) {
      throw new Error(`No user projector registered for surface event: ${event.type}`);
    }
    const content = projector(event);
    if (content === undefined) return;
    return { role: "user", content };
  }
}

export const modelSurface = {
  apply(ctx: Context) {
    new ModelSurface(ctx);
  },
};

declare module "cordis" {
  interface Context {
    modelSurface: ModelSurface;
  }
}
