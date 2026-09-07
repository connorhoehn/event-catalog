import type { Registry } from '../registry/index.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { MetricsCollector } from './metrics.js';
import type { ProducerAttributionStore } from './producer-attribution.js';
import type { PoisonEventDetector } from './poison-detector.js';
import { type CatalogLogger } from '../utils/logger.js';
export declare class MetricsObserver {
    private readonly registry;
    private readonly signal;
    private readonly durable;
    private readonly metrics;
    private readonly attribution?;
    private readonly poisonDetector?;
    private readonly signalUnsubscribes;
    private durablePollTimer;
    private readonly durablePollIntervalMs;
    private readonly lastDurableSent;
    private readonly lastDurableFailed;
    /**
     * Re-entrancy guard for the durable poll.
     *
     * `setInterval` fires on a wall clock, not on completion, and
     * `pollDurableStats` awaits one `getQueueAttributes` round-trip per
     * durable event. Once the message-queue is slow enough that a pass
     * outlasts the 5s interval — precisely the incident you are looking at
     * the metrics during — two passes interleave: both read the same
     * `lastDurableSent` baseline before either writes it, so every publish
     * in the delta is counted twice and the publish rate reads roughly
     * double. Serialize instead.
     */
    private polling;
    private readonly log;
    private readonly warnings;
    constructor(deps: {
        registry: Registry;
        signal: SignalTransport;
        durable: DurableTransport;
        metrics: MetricsCollector;
        attribution?: ProducerAttributionStore;
        poisonDetector?: PoisonEventDetector;
        durablePollIntervalMs?: number;
        /** Diagnostics sink. Defaults to `console.warn`. */
        logger?: CatalogLogger;
    });
    start(): Promise<void>;
    observe(eventName: string, transport: 'signal' | 'durable' | 'both'): Promise<void>;
    /**
     * Re-read one event's subscriber count from the registry.
     *
     * The gauge is push-only, so every path that mutates
     * `entry.subscribers` has to say so or the operator reads a number
     * from whenever the event was first observed. `routes/subscribers.ts`
     * calls this on add and remove; the periodic
     * {@link syncSubscriberCounts} catches the paths that cannot (the
     * stale-subscriber sweeper in `server/index.ts`, and replicated
     * mutations arriving via `RegistryCoordinator`).
     *
     * An event the registry no longer holds is left alone rather than
     * zeroed — `MetricsCollector.reset` owns teardown, and zeroing here
     * would mint handles for a name that no longer exists.
     */
    refreshSubscriberCount(eventName: string): void;
    /** Reconcile every declared event's subscriber gauge with the registry. */
    syncSubscriberCounts(): void;
    /**
     * Release signal subscriptions for events the registry has dropped.
     *
     * `DELETE /api/events/:name` removes the declaration but nothing told
     * the observer, so the Redis subscription stayed open for the process
     * lifetime and kept recording publishes against an event that no
     * longer exists — one retained handler and one map entry per deleted
     * name, and names arrive from HTTP (`POST /api/events/bulk` takes
     * 1000 per request).
     *
     * An event deleted and re-declared between two ticks keeps its
     * subscription: the registry lookup finds it again. A re-declare
     * racing this teardown is safe because `SignalTransport`'s unsubscribe
     * is per-handler and only drops the channel with its last handler.
     */
    private pruneRemovedSubscriptions;
    stop(): Promise<void>;
    private observeSignal;
    private maybePoison;
    private pollDurableStats;
    private pollDurableStatsOnce;
}
//# sourceMappingURL=metrics-observer.d.ts.map