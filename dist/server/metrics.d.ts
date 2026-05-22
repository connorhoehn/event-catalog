import type { RedisClientType } from 'redis';
import type { EventStats } from '../types/index.js';
export declare class MetricsCollector {
    private events;
    private readonly registry;
    private readonly rateWindowSeconds;
    /** wave26-a — ring buffer: eventName → last N rate snapshots. */
    private readonly rateHistory;
    private readonly HISTORY_BUCKETS;
    constructor(rateWindowSeconds?: number);
    recordPublish(eventName: string): void;
    recordError(eventName: string): void;
    setSubscriberCount(eventName: string, count: number): void;
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
    reset(eventName?: string): void;
    snapshotToRedis(redis: RedisClientType): Promise<void>;
    restoreFromRedis(redis: RedisClientType): Promise<void>;
    private getOrCreate;
}
//# sourceMappingURL=metrics.d.ts.map