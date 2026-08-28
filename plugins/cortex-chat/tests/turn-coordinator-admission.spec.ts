import type { UserModelMessage } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { TurnCoordinator, type RunnerFn, type TurnInput, type TurnResult } from "../src/turn-coordinator.js";

function workspaceUser(content: string): UserModelMessage {
  return { role: "user", content };
}

function input(content: string): TurnInput {
  return { messages: [workspaceUser(content)], cause: "message" as const };
}

function completedResult(turnId: string): TurnResult {
  return { status: "completed", turnId, finishReason: "stop", delivered: false };
}

interface ControlledRunner {
  readonly run: RunnerFn;
  readonly resolve: (turnIdOrResult: string | TurnResult, result?: TurnResult) => void;
  readonly emitFinalStep: (turnId: string) => void;
  readonly finish: (turnId: string) => void;
}

function createControlledRunner(): ControlledRunner {
  const pending = new Map<string, { resolve: (value: TurnResult) => void; reject: (e: unknown) => void; signal?: AbortSignal }>();
  let coordinatorRef: TurnCoordinator | null = null;
  const runner: ControlledRunner = {
    run: (_inp: TurnInput, turnId: string, signal: AbortSignal) => {
      const { promise, resolve, reject } = Promise.withResolvers<TurnResult>();
      pending.set(turnId, { resolve, reject, signal });
      signal.addEventListener("abort", () => {
        if (pending.has(turnId)) {
          pending.delete(turnId);
          resolve({ status: "aborted", turnId, reason: signal.reason });
        }
      });
      return promise;
    },
    resolve: (turnIdOrResult: string | TurnResult, maybeResult?: TurnResult) => {
      let turnId: string;
      let result: TurnResult;
      if (typeof turnIdOrResult === "string") {
        turnId = turnIdOrResult;
        result = maybeResult!;
      } else {
        result = turnIdOrResult as TurnResult;
        turnId = (result as { turnId: string }).turnId;
      }
      const entry = pending.get(turnId);
      if (entry) {
        pending.delete(turnId);
        entry.resolve(result);
      }
    },
    emitFinalStep: (turnId: string) => {
      if (coordinatorRef) coordinatorRef.emitFinalStep(turnId);
    },
    finish: (turnId: string) => {
      const entry = pending.get(turnId);
      if (entry) {
        pending.delete(turnId);
        entry.resolve({ status: "completed", turnId, finishReason: "stop", delivered: false });
      }
    },
  };
  (runner as unknown as { _link: (c: TurnCoordinator) => void })._link = (c: TurnCoordinator) => {
    coordinatorRef = c;
  };
  return runner;
}

export function deferredRunner(): ControlledRunner {
  return createControlledRunner();
}

export function controllableRunner(): ControlledRunner {
  return createControlledRunner();
}

export function stepControlledRunner(): ControlledRunner {
  return createControlledRunner();
}

function createCoordinator(options: { runner: ControlledRunner }): TurnCoordinator {
  const coordinator = new TurnCoordinator({ runner: options.runner as unknown as RunnerFn });
  const link = (options.runner as unknown as { _link?: (c: TurnCoordinator) => void })._link;
  if (link) link(coordinator);
  return coordinator;
}

describe("TurnCoordinator admission", () => {
  it("starts one turn and joins messages arriving while it is active", async () => {
    const runner = deferredRunner();
    const coordinator = createCoordinator({ runner });
    const first = coordinator.submit(input("first"));
    const joined = coordinator.submit(input("second"));
    expect(first.kind).toBe("started");
    expect(joined).toMatchObject({ kind: "joined", turnId: first.turnId });
    runner.resolve(completedResult(first.turnId));
    await expect(first.done).resolves.toMatchObject({ status: "completed" });
    await expect(joined.done).resolves.toMatchObject({ status: "completed" });
  });

  it("queues a message arriving after the active turn closes", async () => {
    const runner = controllableRunner();
    const coordinator = createCoordinator({ runner });
    const first = coordinator.submit(input("first"));
    runner.resolve(first.turnId, completedResult(first.turnId));
    await first.done;
    const second = coordinator.submit(input("late"));
    expect(second.kind).toBe("started");
    runner.resolve(second.turnId, completedResult(second.turnId));
    await second.done;
  });

  it("does not lose a message after the final step boundary", async () => {
    const runner = stepControlledRunner();
    const coordinator = createCoordinator({ runner });
    const first = coordinator.submit(input("first"));
    runner.emitFinalStep(first.turnId);
    const late = coordinator.submit(input("late"));
    expect(late.kind).toBe("queued");
    runner.finish(first.turnId);
    await first.done;
    expect(coordinator.pendingMessages()).toContainEqual(expect.objectContaining({ content: "late" }));
    runner.resolve(late.turnId, completedResult(late.turnId));
    await late.done;
  });

  it("active() is null when idle", async () => {
    const runner = deferredRunner();
    const coordinator = createCoordinator({ runner });
    expect(coordinator.active()).toBeNull();
    const admission = coordinator.submit(input("hello"));
    expect(coordinator.active()).not.toBeNull();
    runner.resolve(admission.turnId, completedResult(admission.turnId));
    await admission.done;
    expect(coordinator.active()).toBeNull();
  });
});
