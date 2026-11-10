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

export function createSingleFlightCache<T>(
  load: () => Promise<T>,
  ttlMs: number,
  now: () => number = Date.now,
): SingleFlightCache<T> {
  let value: { v: T; at: number } | undefined;
  let inFlight: Promise<T> | undefined;

  return {
    get(): Promise<T> {
      if (value && now() - value.at < ttlMs) return Promise.resolve(value.v);
      if (inFlight) return inFlight;
      const p = (async () => {
        try {
          const v = await load();
          value = { v, at: now() };
          return v;
        } finally {
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

export interface TokenBucket {
  /** Take one token; false when the bucket is empty. */
  take(): boolean;
}

export function createTokenBucket(
  capacity: number,
  refillPerSecond: number,
  now: () => number = Date.now,
): TokenBucket {
  let tokens = capacity;
  let last = now();
  return {
    take(): boolean {
      const t = now();
      const elapsed = Math.max(0, t - last) / 1000;
      last = t;
      tokens = Math.min(capacity, tokens + elapsed * refillPerSecond);
      if (tokens < 1) return false;
      tokens -= 1;
      return true;
    },
  };
}

export interface MetricsHandlerDeps {
  dlqStore: { list(opts: { limit: number }): Promise<DLQEntry[]> };
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

export const METRICS_CACHE_TTL_MS = 30_000;
export const METRICS_RATE_LIMIT_BURST = 20;
export const METRICS_RATE_LIMIT_PER_SECOND = 5;

export function createMetricsHandler(deps: MetricsHandlerDeps): RouteHandler {
  const now = deps.now ?? Date.now;
  const bucket = createTokenBucket(
    deps.rateLimitBurst ?? METRICS_RATE_LIMIT_BURST,
    deps.rateLimitPerSecond ?? METRICS_RATE_LIMIT_PER_SECOND,
    now,
  );
  const dlqCounts = createSingleFlightCache(async () => {
    const entries = await deps.dlqStore.list({ limit: 1000 });
    const counts = new Map<string, number>();
    for (const entry of entries) {
      counts.set(entry.eventName, (counts.get(entry.eventName) ?? 0) + 1);
    }
    return counts;
  }, deps.cacheTtlMs ?? METRICS_CACHE_TTL_MS, now);

  return async (_req, res) => {
    if (!bucket.take()) {
      res.setHeader('Retry-After', '1');
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.status(429).send('Too many requests\n');
      return;
    }
    // The render is worth not doing for a scraper that has already hung up.
    if (res.destroyed) return;
    try {
      // No `.catch(() => new Map())`: an empty map from a DynamoDB outage
      // would publish "DLQ is empty" during exactly the incident where its
      // depth matters. A failure leaves the last known gauges in place.
      // syncDLQEntries, not a per-event set loop: a drained queue has no
      // entry to iterate, so per-event sets would leave stale depths.
      deps.promMetrics.syncDLQEntries(await dlqCounts.get());
    } catch {
      // gauges may be stale but text rendering still works
    }
    if (res.destroyed) return;
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(deps.promMetrics.renderProm());
  };
}
