/**
 * wave26-e — rolling-window poison-event detector.
 *
 * Tracks validation/publish failures per event in a sliding time window.
 * When a single event exceeds the failure threshold within the window, it
 * is marked "poisoned". Poisoned events surface in the admin Dashboard as
 * a banner + are included in GET /api/events/poisoned.
 *
 * Poison state is in-memory (resets on restart) — the operator dismisses
 * it via DELETE /api/events/:name/poison once the underlying issue is fixed.
 */
export interface PoisonState {
  eventName: string;
  failuresInWindow: number;
  poisonedAt: string;
  threshold: number;
  windowMs: number;
}

export class PoisonEventDetector {
  private readonly windowMs: number;
  private readonly threshold: number;
  /** eventName → timestamps of recent failures within the window. */
  private readonly failures = new Map<string, number[]>();
  /** eventName → PoisonState (only present when poisoned). */
  private readonly poisoned = new Map<string, PoisonState>();

  constructor(opts: { windowMs?: number; threshold?: number } = {}) {
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.threshold = opts.threshold ?? 50;
  }

  /**
   * Record one failure for eventName. Returns true the first time the
   * event crosses the threshold (caller can emit an audit event).
   */
  recordFailure(eventName: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    let timestamps = this.failures.get(eventName) ?? [];
    timestamps = timestamps.filter(t => t >= cutoff);
    timestamps.push(now);
    this.failures.set(eventName, timestamps);

    const alreadyPoison = this.poisoned.has(eventName);
    if (!alreadyPoison && timestamps.length >= this.threshold) {
      this.poisoned.set(eventName, {
        eventName,
        failuresInWindow: timestamps.length,
        poisonedAt: new Date().toISOString(),
        threshold: this.threshold,
        windowMs: this.windowMs,
      });
      return true;
    }

    if (alreadyPoison) {
      const state = this.poisoned.get(eventName)!;
      state.failuresInWindow = timestamps.length;
    }

    return false;
  }

  isPoisoned(eventName: string): boolean {
    return this.poisoned.has(eventName);
  }

  getPoison(eventName: string): PoisonState | null {
    return this.poisoned.get(eventName) ?? null;
  }

  listPoisoned(): PoisonState[] {
    return [...this.poisoned.values()];
  }

  clearPoison(eventName: string): boolean {
    this.failures.delete(eventName);
    return this.poisoned.delete(eventName);
  }

  failureCount(eventName: string): number {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = this.failures.get(eventName) ?? [];
    return timestamps.filter(t => t >= cutoff).length;
  }
}
