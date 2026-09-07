import { MetricsRegistry } from 'distributed-core';
import type { RedisClientType } from 'redis';
import type { EventStats } from '../types/index.js';
/**
 * Ceiling on distinct events this collector will track.
 *
 * Each tracked event costs six distributed-core metric handles, a
 * RateTracker and a 60-slot rate-history ring buffer, and every entry is
 * walked on each 15s health tick (`snapshot()` + `tickRateHistory()`).
 * `POST /api/events/bulk` accepts 1000 declarations per request with no
 * ceiling on requests, and the observer tracks whatever the registry
 * holds, so "however many events exist" is not a bound the service
 * controls. 5000 is ~25x the committed registry (194 events); past it
 * new events are refused a handle and counted in `droppedEvents` rather
 * than growing the process without limit.
 */
export declare const DEFAULT_MAX_TRACKED_EVENTS = 5000;
/**
 * Metric namespace for this collector's registry.
 *
 * Deliberately NOT `event_catalog`, which is what `PromMetrics` uses for
 * the `/metrics` scrape surface. Both classes register a metric called
 * `publish_total`, but with different label sets — `{event}` here versus
 * `{event, transport, mode}` there. They are separate `MetricsRegistry`
 * instances so nothing collides today, but a single Prometheus metric
 * family whose series disagree on label names is invalid exposition and
 * a scraper drops the whole family. Namespacing the two apart means
 * merging the registries, or ever rendering this one, produces
 * `event_catalog_stats_publish_total` and `event_catalog_publish_total`
 * — two well-formed families rather than one broken one.
 *
 * Nothing renders this registry today: `getStats`/`snapshot` read the
 * handles directly and the JSON admin API never sees a metric name, so
 * this constant is invisible outside the collector.
 */
export declare const COLLECTOR_METRIC_NAMESPACE = "event_catalog_stats";
export declare class MetricsCollector {
    private events;
    private readonly registry;
    private readonly rateWindowSeconds;
    /** wave26-a — ring buffer: eventName → last N rate snapshots. */
    private readonly rateHistory;
    private readonly HISTORY_BUCKETS;
    private readonly maxTrackedEvents;
    /**
     * Every event name that has ever been given metric handles.
     *
     * The cap has to be counted here rather than on `this.events`, because
     * `MetricsRegistry` keys its store by `(name, labels)` and has no
     * delete: `reset()` zeroes instances but never removes them, and this
     * class's own `reset(eventName)` only drops its map entry. Counting
     * live entries therefore hands back a cap slot while the memory it was
     * protecting is still held, so a churn of reset + fresh event name
     * grows the process past `maxTrackedEvents` without limit and without
     * ever tripping the guard. A name already in this set costs nothing
     * new, so re-tracking one after a reset is always allowed.
     */
    private readonly knownEvents;
    private droppedEvents;
    private warnedAboutCap;
    constructor(rateWindowSeconds?: number, maxTrackedEvents?: number);
    recordPublish(eventName: string): void;
    recordError(eventName: string): void;
    setSubscriberCount(eventName: string, count: number): void;
    /**
     * The underlying metric store (tests / advanced wiring).
     *
     * Nothing renders it — the JSON admin API reads handles directly — but
     * it is exposed so a test can assert that this registry's metric names
     * never collide with the ones `PromMetrics` puts on `/metrics`.
     */
    getRegistry(): MetricsRegistry;
    /** Events refused a metric handle because the tracking cap was hit. */
    get droppedEventCount(): number;
    /** Number of events currently holding metric handles. */
    size(): number;
    /**
     * Distinct event names that have ever been allocated handles — the
     * quantity the tracking cap is actually enforced against, since the
     * underlying registry never releases a metric it has created.
     */
    knownEventCount(): number;
    updateDurableStats(eventName: string, stats: {
        queueDepth?: number;
        messagesInFlight?: number;
        oldestMessageAge?: number;
    }): void;
    getStats(eventName: string): EventStats | null;
    snapshot(): Record<string, EventStats>;
    /**
     * wave26-a — snapshot current rate for every tracked event into the
     * ring buffer. Called from the server's periodic health interval so
     * the sparkline data stays fresh without a dedicated timer.
     */
    tickRateHistory(): void;
    /**
     * wave26-a — return rate history for one event or all events.
     * When `eventName` is provided returns `{ [eventName]: number[] }`.
     * When omitted returns the full `{ [eventName]: number[] }` map.
     */
    getHistory(eventName?: string): Record<string, number[]>;
    /**
     * Drop tracking for one event (or all of them).
     *
     * The handles must be zeroed before they are dropped. `MetricsRegistry`
     * keys its store by `(name, labels)` and hands back the EXISTING
     * instance when the same key is requested again, so deleting from
     * `this.events` alone left the counter alive in the registry: the next
     * `recordPublish` for that name re-fetched the old handle and
     * `publishCount` resumed from its pre-reset value instead of 1. That
     * made `POST /api/metrics/reset` look like it worked (getStats went
     * null) and then silently un-reset itself on the next publish.
     */
    reset(eventName?: string): void;
    snapshotToRedis(redis: RedisClientType): Promise<void>;
    restoreFromRedis(redis: RedisClientType): Promise<void>;
    private getOrCreate;
}
//# sourceMappingURL=metrics.d.ts.map