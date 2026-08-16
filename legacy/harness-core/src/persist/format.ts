import { deepFreeze } from "../freeze.js";
import type { SessionEvent, SessionHeader } from "../session/types.js";

export const PERSISTENCE_VERSION = 0;

export interface ParsedSessionFile {
  header: SessionHeader;
  events: readonly SessionEvent[];
}

export function serializeHeader(header: SessionHeader): string {
  return JSON.stringify({
    type: "session",
    version: PERSISTENCE_VERSION,
    id: header.id,
    createdAt: header.createdAt,
  });
}

export function serializeEvent(event: SessionEvent): string {
  return JSON.stringify(event);
}

export function parseSessionFile(content: string, expectedId: string): ParsedSessionFile {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  if (lines.length === 0) {
    throw new Error(`Session file is empty: ${expectedId}`);
  }

  const header = parseHeader(lines[0]!, expectedId);
  const events = lines.slice(1).map((line, index) => {
    return parseEvent(line, index + 1, expectedId);
  });

  events.forEach((event, index) => {
    if (event.seq !== index + 1) {
      throw new Error(`Session ${expectedId} has a sequence gap at line ${index + 2}`);
    }
  });

  return { header, events };
}

function parseHeader(line: string, expectedId: string): SessionHeader {
  const value = parseLine(line, 1, expectedId);
  if (value.type !== "session" || value.version !== PERSISTENCE_VERSION || value.id !== expectedId) {
    throw new Error(`Session ${expectedId} has an invalid header at line 1`);
  }
  if (typeof value.createdAt !== "number") {
    throw new Error(`Session ${expectedId} has an invalid createdAt at line 1`);
  }
  return deepFreeze({
    id: expectedId,
    createdAt: value.createdAt,
  });
}

function parseEvent(line: string, lineNumber: number, sessionId: string): SessionEvent {
  const value = parseLine(line, lineNumber, sessionId);
  if (typeof value.type !== "string" || typeof value.seq !== "number" || typeof value.time !== "number") {
    throw new Error(`Session ${sessionId} has an invalid event at line ${lineNumber}`);
  }
  return deepFreeze(value) as SessionEvent;
}

function parseLine(line: string, lineNumber: number, sessionId: string): any {
  try {
    return JSON.parse(line);
  } catch {
    throw new Error(`Session ${sessionId} has malformed JSON at line ${lineNumber}`);
  }
}
