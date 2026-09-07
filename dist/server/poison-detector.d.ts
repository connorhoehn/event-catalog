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
export declare const DEFAULT_MAX_TRACKED_FAILURE_EVENTS = 5000;
export declare class PoisonEventDetector {
    private readonly windowMs;
    private readonly threshold;
    private readonly maxTrackedEvents;
    /** eventName → timestamps of recent failures within the window. */
    private readonly failures;
    /** eventName → PoisonState (only present when poisoned). */
    private readonly poisoned;
    constructor(opts?: {
        windowMs?: number;
        threshold?: number;
        maxTrackedEvents?: number;
    });
    /** Distinct events currently inside the failure window. */
    get trackedEventCount(): number;
    /**
     * Drop events whose every recorded failure has aged out of the window.
     * A poisoned event keeps its slot — its state is operator-dismissed,
     * not time-expired.
     */
    private sweepExpired;
    /**
     * Record one failure for eventName. Returns true the first time the
     * event crosses the threshold (caller can emit an audit event).
     */
    recordFailure(eventName: string): boolean;
    isPoisoned(eventName: string): boolean;
    getPoison(eventName: string): PoisonState | null;
    listPoisoned(): PoisonState[];
    clearPoison(eventName: string): boolean;
    failureCount(eventName: string): number;
}
//# sourceMappingURL=poison-detector.d.ts.map