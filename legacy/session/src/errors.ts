export class TurnNotOpenError extends Error {
  constructor(turn: number, eventType: string) {
    super(`Cannot append '${eventType}' for turn ${turn}: no open turn/start`);
    this.name = "TurnNotOpenError";
  }
}

export class ToolCallMissingError extends Error {
  constructor(turn: number, step: number, toolCallId: string) {
    super(`Cannot append tool/result for turn ${turn} step ${step}: no matching tool/call with id '${toolCallId}'`);
    this.name = "ToolCallMissingError";
  }
}

export class TurnClosedError extends Error {
  constructor(turn: number, eventType: string) {
    super(`Cannot append '${eventType}' for turn ${turn}: turn is already closed`);
    this.name = "TurnClosedError";
  }
}

export class InvalidReplaceRangeError extends Error {
  constructor(start: number, end: number, nodesLength: number) {
    super(`Invalid surfaceOp.replace range [${start}, ${end}) — surface has ${nodesLength} nodes`);
    this.name = "InvalidReplaceRangeError";
  }
}
