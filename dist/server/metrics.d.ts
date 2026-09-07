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
export declare class MetricsCollector {
    private events;
    private readonly registry;
    private readonly rateWindowSeconds;
    /** wave26-a — ring buffer: eventName → last N rate snapshots. */
    private readonly rateHistory;
    private readonly HISTORY_BUCKETS;
    private readonly maxTrackedEvents;
    private droppedEvents;
    private warnedAboutCap;
    constructor(rateWindowSeconds?: number, maxTrackedEvents?: number);
    recordPublish(eventName: string): void;
    recordError(eventName: string): void;
    setSubscriberCount(eventName: string, count: number): void;
    /** Events refused a metric handle because the tracking cap was hit. */
    get droppedEventCount(): number;
    /** Number of events currently holding metric handles. */
    size(): number;
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