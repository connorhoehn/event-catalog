"use strict";
// src/utils/hot-path.ts
//
// Two tiny helpers for the publish hot path. Both were added after
// benchmarking `catalog.publish()` (see `scripts/bench-publish.ts`):
// event-id generation and the "last published at" timestamp together
// accounted for ~95% of a publish that does no I/O.
//
// Neither changes an observable value — same ULID format, same ISO-8601
// string, same entropy source. They only stop paying for the same work
// dozens of times per event.
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventId = eventId;
exports.nowIso = nowIso;
const node_crypto_1 = require("node:crypto");
const ulid_1 = require("ulid");
// ─── event ids ───────────────────────────────────────────────────────────
// The `ulid` package's default PRNG calls `crypto.randomBytes(1)` once per
// random character — 16 separate CSPRNG draws (and 16 Buffer allocations)
// for every id. Measured at ~12µs per `ulid()` on Node 25, which was 90%
// of a stubbed-transport publish.
//
// Drawing the same bytes from a pre-filled pool costs ~0.5µs. Entropy is
// unchanged: `randomFillSync` is the same CSPRNG, just asked for 4KB at a
// time instead of one byte at a time.
const POOL_BYTES = 4096;
const randomPool = Buffer.allocUnsafe(POOL_BYTES);
let poolOffset = POOL_BYTES; // force a refill on first use
const pooledPrng = () => {
    if (poolOffset >= POOL_BYTES) {
        (0, node_crypto_1.randomFillSync)(randomPool);
        poolOffset = 0;
    }
    return randomPool[poolOffset++] / 0xff;
};
// The other half of `ulid()` is `encodeTime`, which divides its way down
// to 10 Crockford base32 characters with a string prepend per character.
// Its input has millisecond resolution, so every id minted inside the
// same millisecond has an identical prefix — memoizing it is exact.
const TIME_LEN = 10;
const RANDOM_LEN = 16;
let prefixMs = -1;
let prefix = '';
/**
 * Generate a ULID: `encodeTime(now, 10) + encodeRandom(16, prng)`, which
 * is exactly what `ulid()` from the `ulid` package computes — same
 * Crockford base32 alphabet, same 26-char length, same lexicographic
 * ordering, same CSPRNG. We just reuse the per-millisecond time prefix
 * and draw randomness from a pool.
 */
function eventId() {
    const ms = Date.now();
    if (ms !== prefixMs) {
        prefixMs = ms;
        prefix = (0, ulid_1.encodeTime)(ms, TIME_LEN);
    }
    return prefix + (0, ulid_1.encodeRandom)(RANDOM_LEN, pooledPrng);
}
// ─── wall-clock ISO strings ──────────────────────────────────────────────
// `new Date().toISOString()` costs ~0.5µs and is called on every publish
// to stamp `metadata.lastPublishedAt`. Its resolution is one millisecond,
// so every call inside the same millisecond necessarily produces the same
// string — memoizing on `Date.now()` is exact, not approximate.
let cachedMs = -1;
let cachedIso = '';
/**
 * `new Date().toISOString()`, memoized for the current millisecond.
 * Returns exactly what an uncached call would return.
 */
function nowIso() {
    const ms = Date.now();
    if (ms !== cachedMs) {
        cachedMs = ms;
        cachedIso = new Date(ms).toISOString();
    }
    return cachedIso;
}
//# sourceMappingURL=hot-path.js.map