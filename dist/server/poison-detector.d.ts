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
export declare class PoisonEventDetector {
    private readonly windowMs;
    private readonly threshold;
    /** eventName → timestamps of recent failures within the window. */
    private readonly failures;
    /** eventName → PoisonState (only present when poisoned). */
    private readonly poisoned;
    constructor(opts?: {
        windowMs?: number;
        threshold?: number;
    });
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