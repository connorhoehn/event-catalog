import type { RouteHandler } from './http-router.js';
import type { DLQEntry } from './dlq-store.js';
/**
 * The root `/metrics` handler, with the DLQ depth query cached and the
 * endpoint rate limited.
 *
 * `/metrics` is unauthenticated (see OPEN_HEALTH_PATHS) and each render
 * needs the DLQ depth per event, which comes from a DynamoDB query. Doing
 * that query per request let any caller turn request volume into database
 * reads, so:
 *
 *   - the per-event counts are cached for `cacheTtlMs` (default 30 s), with
 *     one refresh in flight at a time — concurrent requests during a
 *     refresh share its promise;
 *   - a failed refresh is not cached: the gauges keep their last known
 *     values and the next request after the failure tries again;
 *   - a token bucket (global, default burst 20 refilled at 5 per second)
 *     bounds the request rate; requests over it get 429.
 */
export interface SingleFlightCache<T> {
    /** The cached value when fresh, otherwise the (shared) refresh. */
    get(): Promise<T>;
}
export declare function createSingleFlightCache<T>(load: () => Promise<T>, ttlMs: number, now?: () => number): SingleFlightCache<T>;
export interface TokenBucket {
    /** Take one token; false when the bucket is empty. */
    take(): boolean;
}
export declare function createTokenBucket(capacity: number, refillPerSecond: number, now?: () => number): TokenBucket;
export interface MetricsHandlerDeps {
    dlqStore: {
        list(opts: {
            limit: number;
        }): Promise<DLQEntry[]>;
    };
    promMetrics: {
        syncDLQEntries(counts: Map<string, number>): void;
        renderProm(): string;
    };
    /** Default 30 000 ms. */
    cacheTtlMs?: number;
    /** Token bucket size. Default 20. */
    rateLimitBurst?: number;
    /** Tokens added per second. Default 5. */
    rateLimitPerSecond?: number;
    now?: () => number;
}
export declare const METRICS_CACHE_TTL_MS = 30000;
export declare const METRICS_RATE_LIMIT_BURST = 20;
export declare const METRICS_RATE_LIMIT_PER_SECOND = 5;
export declare function createMetricsHandler(deps: MetricsHandlerDeps): RouteHandler;
//# sourceMappingURL=metrics-endpoint.d.ts.map