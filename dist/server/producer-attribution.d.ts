/**
 * wave26-c — tracks which service names have *actually* published each event,
 * separate from the declared producer field. Surfaces undeclared producers
 * (publishing to an event they don't own) and dead declared producers
 * (declared but never published).
 */
export declare class ProducerAttributionStore {
    private readonly observed;
    record(eventName: string, actualProducer: string): void;
    getObserved(eventName: string): string[];
    getAll(): Record<string, string[]>;
    clear(): void;
}
//# sourceMappingURL=producer-attribution.d.ts.map