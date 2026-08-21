import type { CircuitBreakerOptions, CircuitBreakerStatus } from "./types";

/**
 * Per-model failure tracker used by {@link ModelGroup}.
 *
 * `closed` → healthy. After `failureThreshold` consecutive failures the breaker opens and the
 * model is skipped. Once `recoveryTimeout` seconds pass it becomes `half-open`, letting exactly
 * one probe through: a success closes it, a failure re-opens it for another timeout.
 */
export class CircuitBreaker {
  private _failures = 0;
  private _openedAt = 0;

  constructor(private readonly _options: CircuitBreakerOptions) {}

  get state(): CircuitBreakerStatus["state"] {
    if (this._failures < this._options.failureThreshold) return "closed";
    return Date.now() - this._openedAt >= this._options.recoveryTimeout * 1000 ? "half-open" : "open";
  }

  /** Whether a group should offer this model as a candidate. */
  get available(): boolean {
    return this.state !== "open";
  }

  success(): void {
    this._failures = 0;
    this._openedAt = 0;
  }

  failure(): void {
    this._failures += 1;
    if (this._failures >= this._options.failureThreshold) this._openedAt = Date.now();
  }

  get status(): CircuitBreakerStatus {
    return { state: this.state, failures: this._failures };
  }
}
