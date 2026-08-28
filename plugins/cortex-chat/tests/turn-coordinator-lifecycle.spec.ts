import type { ModelMessage, UserModelMessage } from "@athena-ai/core";
import { describe, expect, it } from "vitest";

import { TurnCoordinator, type RunnerFn, type TurnInput, type TurnResult } from "../src/turn-coordinator.js";

function workspaceUser(content: string): UserModelMessage {
  return { role: "user", content };
}

function input(content: string): TurnInput {
  return { messages: [workspaceUser(content)], cause: "message" as const };
}

interface ControlledRunner {
  readonly run: RunnerFn;
  readonly resolve: (turnIdOrResult: string | TurnResult, result?: TurnResult) => void;
}

function createControlledRunner(): ControlledRunner {
  const pending = new Map<string, { resolve: (value: TurnResult) => void; signal: AbortSignal }>();
  return {
    run: (_inp: TurnInput, turnId: string, signal: AbortSignal) => {
      const { promise, resolve } = Promise.withResolvers<TurnResult>();
      pending.set(turnId, { resolve, signal });
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
  };
}

function createCoordinator(options: { runner: ControlledRunner }): TurnCoordinator {
  return new TurnCoordinator({ runner: options.runner as unknown as RunnerFn });
}

describe("TurnCoordinator lifecycle", () => {
  it("interrupt aborts the active turn", async () => {
    const runner = createControlledRunner();
    const coordinator = createCoordinator({ runner });
    const admission = coordinator.submit(input("first"));
    expect(coordinator.active()).not.toBeNull();
    await coordinator.interrupt("test-reason");
    await expect(admission.done).resolves.toMatchObject({ status: "aborted" });
    expect(coordinator.active()).toBeNull();
  });

  it("stop clears timer, aborts active, and rejects future submits", async () => {
    const runner = createControlledRunner();
    const coordinator = createCoordinator({ runner });
    const first = coordinator.submit(input("first"));
    await coordinator.stop();
    await expect(first.done).resolves.toMatchObject({ status: "aborted" });
    expect(() => coordinator.submit(input("late"))).toThrow(/TurnCoordinator is stopped/);
  });

  it("keeps queued inputs after stop instead of dropping them", async () => {
    const runner = createControlledRunner();
    const coordinator = createCoordinator({ runner });
    const first = coordinator.submit(input("first"));
    // Signal finalizing so next submit becomes queued rather than joined
    coordinator.emitFinalStep(first.turnId);
    const queued = coordinator.submit(input("queued"));
    expect(queued.kind).toBe("queued");
    await coordinator.stop();
    await expect(first.done).resolves.toMatchObject({ status: "aborted" });
    expect(coordinator.pendingMessages()).toContainEqual(expect.objectContaining({ content: "queued" }));
    // The queued admission stays pending by design; future submits are still rejected.
    expect(() => coordinator.submit(input("another"))).toThrow(/TurnCoordinator is stopped/);
    // Prevent unhandled rejection on queued promise; catch it
    queued.done.catch(() => {});
  });

  it("clears aggregate timer on stop and does not leave detached promise", async () => {
    const runner = createControlledRunner();
    const coordinator = new TurnCoordinator({ runner: runner as unknown as RunnerFn, aggregateWindow: 1000 });
    const queued = coordinator.submit(input("first"));
    expect(queued.kind).toBe("queued");
    expect(coordinator.active()).toBeNull();
    await coordinator.stop();
    // Aggregate timer should be cleared; active remains null
    expect(coordinator.active()).toBeNull();
    // Future submit rejected
    expect(() => coordinator.submit(input("after"))).toThrow(/TurnCoordinator is stopped/);
    queued.done.catch(() => {});
  });

  it("appendWorkspaceDelta writes through the shared workspace", async () => {
    const appended: ModelMessage[] = [];
    const runner = createControlledRunner();
    const coordinator = new TurnCoordinator({ runner: runner as unknown as RunnerFn, workspace: appended });
    const delta = workspaceUser("delta");
    coordinator.appendWorkspaceDelta([delta]);
    expect(appended).toContainEqual(expect.objectContaining({ content: "delta" }));
  });

  it("interrupt without active turn is a no-op", async () => {
    const runner = createControlledRunner();
    const coordinator = createCoordinator({ runner });
    await expect(coordinator.interrupt("nothing")).resolves.toBeUndefined();
    expect(coordinator.active()).toBeNull();
  });

  it("stop without active turn still rejects future submits", async () => {
    const runner = createControlledRunner();
    const coordinator = createCoordinator({ runner });
    await coordinator.stop();
    expect(() => coordinator.submit(input("x"))).toThrow(/TurnCoordinator is stopped/);
  });
});
