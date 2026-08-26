import { isAtSelf } from "@athena-ai/protocol-im";
import type { IMMessageEvent } from "@athena-ai/protocol-im";

export function shouldTrigger(event: IMMessageEvent): boolean {
  if (event.isDirect) return true;
  if (isAtSelf(event)) return true;
  return false;
}
