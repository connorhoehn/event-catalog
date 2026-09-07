/** Default per-map key cap. Matches the server's DEFAULT_MAX_TRACKED_KEYS. */
export declare const DEFAULT_MAX_TRACKED_KEYS = 1000;
/**
 * Insert `key` into `map`, evicting the oldest entry first when the map is
 * at `max`. `Map` iterates in insertion order, so `keys().next()` is the
 * oldest key — no LRU bookkeeping needed.
 *
 * @returns the evicted key, or `undefined` when nothing was evicted.
 */
export declare function rememberBounded<V>(map: Map<string, V>, key: string, value: V, max: number): string | undefined;
/**
 * Per-key counters that cannot grow without bound.
 *
 * Per-key detail is capped at `max` and evicted oldest-first. The
 * aggregates (`total`, `evictedKeys`, `evictedTotal`) are never evicted,
 * so "how many drops has this process seen?" stays answerable even when
 * the key space is hostile.
 */
export declare class BoundedCounter {
    private readonly counts;
    private readonly max;
    private totalCount;
    private evictedKeyCount;
    private evictedValueTotal;
    constructor(max?: number);
    /** Add `by` to `key`'s counter and return the new per-key value. */
    increment(key: string, by?: number): number;
    get(key: string): number;
    /** A copy of the tracked (non-evicted) per-key counters. */
    snapshot(): Map<string, number>;
    /** Sum of every increment ever recorded — unaffected by eviction. */
    get total(): number;
    /** How many distinct keys have been evicted for capacity. */
    get evictedKeys(): number;
    /** Sum of the counts carried by evicted keys. */
    get evictedTotal(): number;
    get size(): number;
    /** Drop per-key detail. Aggregates are preserved. */
    clear(): void;
    /** Drop per-key detail *and* aggregates. For tests and static resets. */
    reset(): void;
}
export interface LogThrottleOptions {
    /**
     * Cap on the dedupe key set. Beyond this, keys evict oldest-first — and
     * an evicted key may log once more, which the window ceiling absorbs.
     */
    maxKeys?: number;
    /**
     * How long a key stays "already logged". `Infinity` (the default) is
     * warn-once-per-process, matching the behaviour these call sites had
     * before throttling.
     */
    keyIntervalMs?: number;
    /** Rolling window for the global ceiling. Default 60s. */
    windowMs?: number;
    /**
     * Max lines emitted per window across *all* keys. This is the bound
     * that holds when the key space is caller-controlled. Default 10.
     */
    maxPerWindow?: number;
}
/**
 * Decides whether a log line on a hot path may be emitted.
 *
 * Call {@link attempt}; a non-null return means "log it", and the number is
 * how many occurrences were suppressed since the previous emitted line —
 * append it so the reader knows the line is a sample, not the whole story.
 * `suppressedTotal` keeps the count for the life of the process, so a
 * suppressed log is still a counted event.
 */
export declare class LogThrottle {
    private readonly seen;
    private readonly maxKeys;
    private readonly keyIntervalMs;
    private readonly windowMs;
    private readonly maxPerWindow;
    private windowStart;
    private windowCount;
    private suppressedSinceEmit;
    private suppressedEver;
    constructor(options?: LogThrottleOptions);
    /**
     * @returns `null` when this occurrence must not be logged; otherwise the
     *   number of occurrences suppressed since the last emitted line.
     */
    attempt(key: string): number | null;
    /** ` (+N similar suppressed)`, or `''` when nothing was suppressed. */
    static suffix(suppressed: number): string;
    /** Occurrences never logged, for the life of the process. */
    get suppressedTotal(): number;
    get trackedKeys(): number;
    /** Re-arm every key — used when a transport reconnects. */
    clear(): void;
}
//# sourceMappingURL=bounded.d.ts.map