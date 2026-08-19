import type { CortexChat } from "./cortex-chat";

export { CortexChat } from "./cortex-chat";
export { CortexChat as default } from "./cortex-chat";

declare module "cordis" {
  interface Context {
    cortex: CortexChat;
  }
}
