"use strict";
// src/utils/bounded.ts
//
// Bounded bookkeeping for the client hot path.
//
// Everything in `src/client/` runs inside a long-lived consumer process —
// often for weeks without a restart — and several of its maps are keyed by
// values a *caller* chooses: an event name, a Redis channel, a per-document
// channel derived from a payload field. An unbounded `Map` keyed like that
// is not a cache, it is a leak with a slow fuse: a typo'd event name in a
// retry loop, a channel-per-document broadcast pattern, or an attacker
// sending unknown frame types all grow it without limit.
//
// Two primitives here, mirroring `src/server/alerting.ts`'s `remember()`:
//
//   - `BoundedCounter` — a `Map<string, number>` with insertion-ordered
//     eviction. Per-key detail is capped; the aggregate totals are exact
//     for the life of the process, so evicting a key never loses the fact
//     that something happened.
//   - `LogThrottle` — dedupe-per-key *and* a global rate ceiling. The
//     per-key half alone is not enough: with an unbounded key space,
//     "warn once per key" is still unbounded logging, and an eviction-
//     thrashing key set re-warns forever. The window ceiling is what
//     actually stops an outage from turning into a log-volume incident.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LogThrottle = exports.BoundedCounter = exports.DEFAULT_MAX_TRACKED_KEYS = void 0;
exports.rememberBounded = rememberBounded;
/** Default per-map key cap. Matches the server's DEFAULT_MAX_TRACKED_KEYS. */
exports.DEFAULT_MAX_TRACKED_KEYS = 1000;
/**
 * Insert `key` into `map`, evicting the oldest entry first when the map is
 * at `max`. `Map` iterates in insertion order, so `keys().next()` is the
 * oldest key — no LRU bookkeeping needed.
 *
 * @returns the evicted key, or `undefined` when nothing was evicted.
 */
function rememberBounded(map, key, value, max) {
    let evicted;
    if (!map.has(key) && map.size >= max) {
        const oldest = map.keys().next();
        if (!oldest.done) {
            evicted = oldest.value;
            map.delete(evicted);
        }
    }
    map.set(key, value);
    return evicted;
}
/**
 * Per-key counters that cannot grow without bound.
 *
 * Per-key detail is capped at `max` and evicted oldest-first. The
 * aggregates (`total`, `evictedKeys`, `evictedTotal`) are never evicted,
 * so "how many drops has this process seen?" stays answerable even when
 * the key space is hostile.
 */
class BoundedCounter {
    counts = new Map();
    max;
    totalCount = 0;
    evictedKeyCount = 0;
    evictedValueTotal = 0;
    constructor(max = exports.DEFAULT_MAX_TRACKED_KEYS) {
        this.max = Math.max(1, max);
    }
    /** Add `by` to `key`'s counter and return the new per-key value. */
    increment(key, by = 1) {
        this.totalCount += by;
        const next = (this.counts.get(key) ?? 0) + by;
        if (!this.counts.has(key) && this.counts.size >= this.max) {
            const oldest = this.counts.keys().next();
            if (!oldest.done) {
                // Price the eviction before deleting, so `evictedTotal` still
                // accounts for the drops/publishes that key had accumulated.
                this.evictedValueTotal += this.counts.get(oldest.value) ?? 0;
                this.evictedKeyCount++;
                this.counts.delete(oldest.value);
            }
        }
        this.counts.set(key, next);
        return next;
    }
    get(key) {
        return this.counts.get(key) ?? 0;
    }
    /** A copy of the tracked (non-evicted) per-key counters. */
    snapshot() {
        return new Map(this.counts);
    }
    /** Sum of every increment ever recorded — unaffected by eviction. */
    get total() {
        return this.totalCount;
    }
    /** How many distinct keys have been evicted for capacity. */
    get evictedKeys() {
        return this.evictedKeyCount;
    }
    /** Sum of the counts carried by evicted keys. */
    get evictedTotal() {
        return this.evictedValueTotal;
    }
    get size() {
        return this.counts.size;
    }
    /** Drop per-key detail. Aggregates are preserved. */
    clear() {
        this.counts.clear();
    }
    /** Drop per-key detail *and* aggregates. For tests and static resets. */
    reset() {
        this.counts.clear();
        this.totalCount = 0;
        this.evictedKeyCount = 0;
        this.evictedValueTotal = 0;
    }
}
exports.BoundedCounter = BoundedCounter;
/**
 * Decides whether a log line on a hot path may be emitted.
 *
 * Call {@link attempt}; a non-null return means "log it", and the number is
 * how many occurrences were suppressed since the previous emitted line —
 * append it so the reader knows the line is a sample, not the whole story.
 * `suppressedTotal` keeps the count for the life of the process, so a
 * suppressed log is still a counted event.
 */
class LogThrottle {
    seen = new Map();
    maxKeys;
    keyIntervalMs;
    windowMs;
    maxPerWindow;
    windowStart = 0;
    windowCount = 0;
    suppressedSinceEmit = 0;
    suppressedEver = 0;
    constructor(options = {}) {
        this.maxKeys = Math.max(1, options.maxKeys ?? 512);
        this.keyIntervalMs = options.keyIntervalMs ?? Infinity;
        this.windowMs = options.windowMs ?? 60_000;
        this.maxPerWindow = Math.max(1, options.maxPerWindow ?? 10);
    }
    /**
     * @returns `null` when this occurrence must not be logged; otherwise the
     *   number of occurrences suppressed since the last emitted line.
     */
    attempt(key) {
        const now = Date.now();
        if (now - this.windowStart >= this.windowMs) {
            this.windowStart = now;
            this.windowCount = 0;
        }
        const last = this.seen.get(key);
        const keyIsFresh = last === undefined || now - last >= this.keyIntervalMs;
        if (!keyIsFresh || this.windowCount >= this.maxPerWindow) {
            this.suppressedSinceEmit++;
            this.suppressedEver++;
            return null;
        }
        rememberBounded(this.seen, key, now, this.maxKeys);
        this.windowCount++;
        const suppressed = this.suppressedSinceEmit;
        this.suppressedSinceEmit = 0;
        return suppressed;
    }
    /** ` (+N similar suppressed)`, or `''` when nothing was suppressed. */
    static suffix(suppressed) {
        return suppressed > 0 ? ` (+${suppressed} similar suppressed)` : '';
    }
    /** Occurrences never logged, for the life of the process. */
    get suppressedTotal() {
        return this.suppressedEver;
    }
    get trackedKeys() {
        return this.seen.size;
    }
    /** Re-arm every key — used when a transport reconnects. */
    clear() {
        this.seen.clear();
    }
}
exports.LogThrottle = LogThrottle;
//# sourceMappingURL=bounded.js.map