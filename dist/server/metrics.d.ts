import type { EventStats } from '../types/index.js';
export declare class MetricsCollector {
    private counters;
    private readonly rateWindowMs;
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
    reset(eventName?: string): void;
    private getOrCreate;
    private pruneTimestamps;
    private calculateRate;
}
//# sourceMappingURL=metrics.d.ts.map