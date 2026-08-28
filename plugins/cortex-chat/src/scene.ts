export interface SceneAddress {
  readonly bodySid: string;
  readonly channelId: string;
}

export interface SceneCursor {
  readonly timestamp: number;
  readonly messageId: string;
}

export function encodeSceneAddress(scene: SceneAddress): string {
  if (!scene || typeof scene.bodySid !== "string" || typeof scene.channelId !== "string") {
    throw new Error(`Invalid SceneAddress value: ${String(scene)}`);
  }
  if (scene.bodySid.length === 0 || scene.channelId.length === 0) {
    throw new Error(`Invalid SceneAddress value: ${JSON.stringify(scene)}`);
  }
  return `${encodeURIComponent(scene.bodySid)}/${encodeURIComponent(scene.channelId)}`;
}

export function decodeSceneAddress(value: string): SceneAddress {
  if (typeof value !== "string") {
    throw new Error(`Invalid SceneAddress value: ${String(value)}`);
  }
  const parts = value.split("/");
  if (parts.length !== 2) {
    throw new Error(`Invalid SceneAddress value: ${value}`);
  }
  let bodySid: string;
  let channelId: string;
  try {
    bodySid = decodeURIComponent(parts[0]!);
    channelId = decodeURIComponent(parts[1]!);
  } catch {
    throw new Error(`Invalid SceneAddress value: ${value}`);
  }
  if (bodySid.length === 0 || channelId.length === 0) {
    throw new Error(`Invalid SceneAddress value: ${value}`);
  }
  return { bodySid, channelId };
}

export function sameScene(a: SceneAddress | null, b: SceneAddress | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;
  return a.bodySid === b.bodySid && a.channelId === b.channelId;
}

export function parseInitialFocus(value: string): SceneAddress | null {
  if (value === "") return null;
  try {
    return decodeSceneAddress(value);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Ensure the thrown error contains both the Scene marker and the supplied value
    if (message.includes(value)) throw error;
    throw new Error(`${message} (initialFocus: ${value})`);
  }
}
