/**
 * Generate a ULID: `encodeTime(now, 10) + encodeRandom(16, prng)`, which
 * is exactly what `ulid()` from the `ulid` package computes — same
 * Crockford base32 alphabet, same 26-char length, same lexicographic
 * ordering, same CSPRNG. We just reuse the per-millisecond time prefix
 * and draw randomness from a pool.
 */
export declare function eventId(): string;
/**
 * `new Date().toISOString()`, memoized for the current millisecond.
 * Returns exactly what an uncached call would return.
 */
export declare function nowIso(): string;
//# sourceMappingURL=hot-path.d.ts.map