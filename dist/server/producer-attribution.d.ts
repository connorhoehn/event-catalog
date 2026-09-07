/**
 * wave26-c — tracks which service names have *actually* published each event,
 * separate from the declared producer field. Surfaces undeclared producers
 * (publishing to an event they don't own) and dead declared producers
 * (declared but never published).
 */
export declare class ProducerAttributionStore {
    private readonly observed;
    private droppedEvents;
    private droppedProducers;
    /**
     * Both dimensions are caller-controlled and neither was bounded.
     *
     * `actualProducer` is `envelope.metadata.producer` — a string chosen per
     * message by whoever published to Redis — and `eventName` is any channel
     * this process observes. A publisher that varies either field per message
     * grew this map forever, and `GET /api/events/attribution` re-serialized
     * the whole thing on every call. This is attribution telemetry, not a
     * ledger: capping it costs visibility into the least-recent keys and
     * nothing else. Counters keep the loss visible.
     */
    private readonly maxEvents;
    private readonly maxProducersPerEvent;
    constructor(opts?: {
        maxEvents?: number;
        maxProducersPerEvent?: number;
    });
    record(eventName: string, actualProducer: string): void;
    /** Eviction counters, so a capped store never looks like a quiet one. */
    getOverflowStats(): {
        events: number;
        droppedEvents: number;
        droppedProducers: number;
    };
    /** Drop attribution for an event that no longer exists. */
    forget(eventName: string): void;
    getObserved(eventName: string): string[];
    getAll(): Record<string, string[]>;
    clear(): void;
}
//# sourceMappingURL=producer-attribution.d.ts.map