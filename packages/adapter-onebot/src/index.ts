import { OneBotBot } from "./bot";
import * as OneBot from "./types";

export { OneBot, OneBotBot };
export { OneBotMessageEncoder, PRIVATE_PFX } from "./message";
export { OneBotWsClient, OneBotWsServer } from "./ws";
export { OneBotHttpServer } from "./http";
export { CQCode } from "./cqcode";

export default OneBotBot;

declare module "@satorijs/core" {
  interface Session {
    onebot?: OneBot.Payload & OneBot.Internal;
  }
}
