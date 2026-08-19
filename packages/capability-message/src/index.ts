import type { MessageService } from "./service";

export { MessageService } from "./service";
export { MessageService as default } from "./service";
export type { MessageServiceConfig, AdapterConfig, Bot, Session, Message, SendOptions, Fragment } from "./types";

declare module "cordis" {
  interface Context {
    message: MessageService;
  }
}
