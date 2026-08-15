import type { UserContent } from "ai";

/**
 * Two-slot input buffer for an Agent.
 * next-turn: drained once at the top of each Turn (by claimTurn).
 * next-step: drained once at the top of each Step (by claimStep).
 *
 * Slots have no capacity limit; back-pressure is the caller's responsibility.
 */
export class Inbox {
  private _turn: UserContent[] = [];
  private _step: UserContent[] = [];

  /** Append content to the next-turn slot. */
  pushTurn(content: UserContent): void {
    this._turn.push(content);
  }

  /** Append content to the next-step slot. */
  pushStep(content: UserContent): void {
    this._step.push(content);
  }

  /**
   * Atomically drain and return all next-turn content.
   * Returns an empty array if the slot is empty.
   */
  claimTurn(): UserContent[] {
    const items = this._turn;
    this._turn = [];
    return items;
  }

  /**
   * Atomically drain and return all next-step content.
   * Returns an empty array if the slot is empty.
   */
  claimStep(): UserContent[] {
    const items = this._step;
    this._step = [];
    return items;
  }

  get hasTurn(): boolean {
    return this._turn.length > 0;
  }
  get hasStep(): boolean {
    return this._step.length > 0;
  }
}
