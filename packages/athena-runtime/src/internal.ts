import { randomUUID } from "node:crypto";

export type Awaitable<T> = T | PromiseLike<T>;

export function createId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}
