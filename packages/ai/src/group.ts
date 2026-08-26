import type { Logger } from "cordis";

import { CircuitBreaker } from "./circuit-breaker";
import type { Candidate, CircuitBreakerStatus, GroupDeclaration, GroupStrategy } from "./types";

/** Turns a full model id into the pieces a {@link Candidate} exposes. Throws when unresolvable. */
export type CandidateResolver = (id: string) => Pick<Candidate, "model" | "metadata">;

interface GroupEntry {
  id: string;
  breaker: CircuitBreaker;
}

/**
 * A named set of interchangeable language models.
 *
 * The group only *selects* models — it never wraps `generateText` / `streamText`. Running the
 * attempts and deciding when to stop is the Cortex's business; the group just orders the list,
 * hides models whose breaker is open, and collects the success/failure reports coming back.
 */
export class ModelGroup {
  readonly strategy: GroupStrategy;
  private readonly _entries: readonly GroupEntry[];
  private _cursor = 0;

  constructor(
    readonly name: string,
    declaration: GroupDeclaration,
    private readonly _resolve: CandidateResolver,
    private readonly _logger: Logger,
  ) {
    this.strategy = declaration.strategy;
    this._entries = declaration.models.map((id) => ({ id, breaker: new CircuitBreaker(declaration.circuitBreaker) }));
  }

  get models(): string[] {
    return this._entries.map((entry) => entry.id);
  }

  candidates(): Candidate[] {
    const ordered = this._ordered();
    let usable = ordered.filter((entry) => entry.breaker.available);
    if (usable.length === 0 && ordered.length > 0) {
      // Every model is tripped. A mute digital being is worse than one more doomed attempt,
      // so hand back the full list and let the Cortex decide when to give up.
      this._logger.warn(`Group "${this.name}": every circuit breaker is open; offering all ${ordered.length} model(s) anyway`);
      usable = ordered;
    }

    const candidates: Candidate[] = [];
    for (const entry of usable) {
      try {
        const { model, metadata } = this._resolve(entry.id);
        candidates.push({
          id: entry.id,
          model,
          metadata,
          success: () => entry.breaker.success(),
          failure: () => entry.breaker.failure(),
        });
      } catch (error) {
        // A missing provider must not take down the whole group.
        this._logger.warn(`Group "${this.name}": skipping "${entry.id}":`, error);
      }
    }
    return candidates;
  }

  status(): Map<string, CircuitBreakerStatus> {
    return new Map(this._entries.map((entry) => [entry.id, entry.breaker.status]));
  }

  reset(id: string): void {
    const entry = this._entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`Model "${id}" is not a member of group "${this.name}" (members: ${this.models.join(", ")})`);
    entry.breaker.success();
  }

  private _ordered(): GroupEntry[] {
    if (this.strategy === "failover") return [...this._entries];

    if (this.strategy === "random") {
      const shuffled = [...this._entries];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    }

    if (this._entries.length === 0) return [];
    const offset = this._cursor;
    this._cursor = (this._cursor + 1) % this._entries.length;
    return [...this._entries.slice(offset), ...this._entries.slice(0, offset)];
  }
}
