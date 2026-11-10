"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.METRICS_RATE_LIMIT_PER_SECOND = exports.METRICS_RATE_LIMIT_BURST = exports.METRICS_CACHE_TTL_MS = void 0;
exports.createSingleFlightCache = createSingleFlightCache;
exports.createTokenBucket = createTokenBucket;
exports.createMetricsHandler = createMetricsHandler;
function createSingleFlightCache(load, ttlMs, now = Date.now) {
    let value;
    let inFlight;
    return {
        get() {
            if (value && now() - value.at < ttlMs)
                return Promise.resolve(value.v);
            if (inFlight)
                return inFlight;
            const p = (async () => {
                try {
                    const v = await load();
                    value = { v, at: now() };
                    return v;
                }
                finally {
                    // Cleared on success and on failure alike, so a rejected load is
                    // never handed to a later caller.
                    inFlight = undefined;
                }
            })();
            inFlight = p;
            return p;
        },
    };
}
function createTokenBucket(capacity, refillPerSecond, now = Date.now) {
    let tokens = capacity;
    let last = now();
    return {
        take() {
            const t = now();
            const elapsed = Math.max(0, t - last) / 1000;
            last = t;
            tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
            if (tokens < 1)
                return false;
            tokens -= 1;
            return true;
        },
    };
}
exports.METRICS_CACHE_TTL_MS = 30_000;
exports.METRICS_RATE_LIMIT_BURST = 20;
exports.METRICS_RATE_LIMIT_PER_SECOND = 5;
function createMetricsHandler(deps) {
    const now = deps.now ?? Date.now;
    const bucket = createTokenBucket(deps.rateLimitBurst ?? exports.METRICS_RATE_LIMIT_BURST, deps.rateLimitPerSecond ?? exports.METRICS_RATE_LIMIT_PER_SECOND, now);
    const dlqCounts = createSingleFlightCache(async () => {
        const entries = await deps.dlqStore.list({ limit: 1000 });
        const counts = new Map();
        for (const entry of entries) {
            counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
        }
        return counts;
    }, deps.cacheTtlMs ?? exports.METRICS_CACHE_TTL_MS, now);
    return async (_req, res) => {
        if (!bucket.take()) {
            res.setHeader('Retry-After', '1');
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.status(429).send('Too many requests\n');
            return;
        }
        // The render is worth not doing for a scraper that has already hung up.
        if (res.destroyed)
            return;
        try {
            // No `.catch(() => new Map())`: an empty map from a DynamoDB outage
            // would publish "DLQ is empty" during exactly the incident where its
            // depth matters. A failure leaves the last known gauges in place.
            // syncDLQEntries, not a per-event set loop: a drained queue has no
            // entry to iterate, so per-event sets would leave stale depths.
            deps.promMetrics.syncDLQEntries(await dlqCounts.get());
        }
        catch {
            // gauges may be stale but text rendering still works
        }
        if (res.destroyed)
            return;
        res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
        res.send(deps.promMetrics.renderProm());
    };
}
//# sourceMappingURL=metrics-endpoint.js.map