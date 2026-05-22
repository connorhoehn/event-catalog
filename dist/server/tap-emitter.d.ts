import { EventEmitter } from 'node:events';
export interface TapEvent {
    /** Canonical event name as declared in the registry. */
    eventName: string;
    /** Namespace from the RegistryEntry (auto-derived or explicit). */
    namespace: string;
    /** First authoritative producer from the declaration. */
    producer: string;
    transport: 'signal' | 'durable';
    /** ISO 8601 timestamp at observation (catalog server wall clock). */
    timestamp: string;
    /** Redis channel pattern (signal-only). */
    channel?: string;
    /** Message-queue queue name (durable-only). */
    queue?: string;
    /**
     * Full inner envelope payload when available (signal taps deliver
     * this; durable polls do not — only the publish count rises).
     */
    envelope?: unknown;
}
export interface TapFilter {
    eventName?: string;
    transport?: 'signal' | 'durable';
    producer?: string;
    namespace?: string;
}
/**
 * Apply a TapFilter to a TapEvent. Exported for testability — the route
 * uses the same predicate.
 */
export declare function matchesTapFilter(event: TapEvent, filter: TapFilter): boolean;
declare class TapEmitter extends EventEmitter {
    publish(event: TapEvent): void;
}
/**
 * Module-singleton tap emitter. Both the producer side (MetricsObserver
 * + durable poll) and the consumer side (SSE route handler) import this
 * one instance — process-local, no Redis round-trip, no broadcast amp.
 *
 * setMaxListeners(0) — every SSE client adds one listener; we don't
 * want Node's default warning at 10.
 */
export declare const tapEmitter: TapEmitter;
export {};
//# sourceMappingURL=tap-emitter.d.ts.map