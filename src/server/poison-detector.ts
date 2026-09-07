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

/**
 * Ceiling on distinct events held in the failure window.
 *
 * `failures` is keyed by event name and event names are writable over
 * HTTP, so without a cap this is an unbounded map fed by request input —
 * and entries are only ever pruned by a subsequent failure for the SAME
 * event, so a burst of one-off failures across many names never ages
 * out. Sweeping expired windows before admitting a new key keeps the map
 * proportional to what is actually failing, not to what ever failed.
 */
export const DEFAULT_MAX_TRACKED_FAILURE_EVENTS = 5000;

export class PoisonEventDetector {
  private readonly windowMs: number;
  private readonly threshold: number;
  private readonly maxTrackedEvents: number;
  /** eventName → timestamps of recent failures within the window. */
  private readonly failures = new Map<string, number[]>();
  /** eventName → PoisonState (only present when poisoned). */
  private readonly poisoned = new Map<string, PoisonState>();

  constructor(opts: { windowMs?: number; threshold?: number; maxTrackedEvents?: number } = {}) {
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.threshold = opts.threshold ?? 50;
    this.maxTrackedEvents = opts.maxTrackedEvents ?? DEFAULT_MAX_TRACKED_FAILURE_EVENTS;
  }

  /** Distinct events currently inside the failure window. */
  get trackedEventCount(): number {
    return this.failures.size;
  }

  /**
   * Drop events whose every recorded failure has aged out of the window.
   * A poisoned event keeps its slot — its state is operator-dismissed,
   * not time-expired.
   */
  private sweepExpired(cutoff: number): void {
    for (const [name, timestamps] of this.failures) {
      if (this.poisoned.has(name)) continue;
      if (timestamps.length === 0 || timestamps[timestamps.length - 1]! < cutoff) {
        this.failures.delete(name);
      }
    }
  }

  /**
   * Record one failure for eventName. Returns true the first time the
   * event crosses the threshold (caller can emit an audit event).
   */
  recordFailure(eventName: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;

    const existing = this.failures.get(eventName);
    if (!existing && this.failures.size >= this.maxTrackedEvents) {
      this.sweepExpired(cutoff);
      if (this.failures.size >= this.maxTrackedEvents) return false;
    }

    let timestamps = existing ?? [];
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
