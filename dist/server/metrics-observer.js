"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsObserver = void 0;
const durable_js_1 = require("../client/durable.js");
const tap_emitter_js_1 = require("./tap-emitter.js");
const audit_emitter_js_1 = require("./audit-emitter.js");
/**
 * Ceiling on how many synthetic publish/error observations one poll pass
 * will replay from a single queue's counter delta.
 */
const MAX_CATCHUP_PER_POLL = 10_000;
class MetricsObserver {
    registry;
    signal;
    durable;
    metrics;
    attribution;
    poisonDetector;
    signalUnsubscribes = new Map();
    durablePollTimer = null;
    durablePollIntervalMs;
    // Track durable transport counters separately from MetricsCollector's
    // shared publishCount/errorCount. For transport:'both' events the
    // signal observation path also bumps those shared counters, so using
    // them as the "what we've attributed to durable so far" baseline
    // makes the delta go negative and silently drops durable observations.
    lastDurableSent = new Map();
    lastDurableFailed = new Map();
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
    polling = false;
    constructor(deps) {
        this.registry = deps.registry;
        this.signal = deps.signal;
        this.durable = deps.durable;
        this.metrics = deps.metrics;
        this.attribution = deps.attribution;
        this.poisonDetector = deps.poisonDetector;
        this.durablePollIntervalMs = deps.durablePollIntervalMs ?? 5000;
    }
    async start() {
        const entries = this.registry.list();
        for (const entry of entries) {
            await this.observe(entry.name, entry.transport);
        }
        // Durable-only events never reach `observeSignal`, so without this
        // their subscriber gauge sat at 0 for the process lifetime no matter
        // how many consumers had registered.
        this.syncSubscriberCounts();
        this.durablePollTimer = setInterval(() => {
            // Reconcile first and outside `pollDurableStats`'s re-entrancy
            // guard: this is synchronous and local, and it must not be skipped
            // because a message-queue round-trip is hung.
            this.syncSubscriberCounts();
            this.pollDurableStats();
        }, this.durablePollIntervalMs);
    }
    async observe(eventName, transport) {
        if (transport === 'signal' || transport === 'both') {
            await this.observeSignal(eventName);
        }
        this.refreshSubscriberCount(eventName);
    }
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
    refreshSubscriberCount(eventName) {
        const entry = this.registry.get(eventName);
        if (!entry)
            return;
        this.metrics.setSubscriberCount(eventName, entry.subscribers.length);
    }
    /** Reconcile every declared event's subscriber gauge with the registry. */
    syncSubscriberCounts() {
        for (const entry of this.registry.list()) {
            this.metrics.setSubscriberCount(entry.name, entry.subscribers.length);
        }
    }
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
    async pruneRemovedSubscriptions() {
        for (const [name, unsub] of [...this.signalUnsubscribes]) {
            if (this.registry.get(name))
                continue;
            this.signalUnsubscribes.delete(name);
            try {
                await unsub();
            }
            catch (err) {
                console.warn(`[metrics-observer] failed to release channel "${name}":`, err.message);
            }
        }
    }
    async stop() {
        if (this.durablePollTimer) {
            clearInterval(this.durablePollTimer);
            this.durablePollTimer = null;
        }
        for (const [, unsub] of this.signalUnsubscribes) {
            await unsub();
        }
        this.signalUnsubscribes.clear();
        // Reset durable baselines so a restart against a fresh transport
        // (counters back to 0) doesn't compute a negative delta from a
        // stale high-water mark.
        this.lastDurableSent.clear();
        this.lastDurableFailed.clear();
    }
    async observeSignal(eventName) {
        if (this.signalUnsubscribes.has(eventName))
            return;
        if (!this.signal.isConnected())
            return;
        try {
            const unsub = await this.signal.subscribe(eventName, (envelope) => {
                this.metrics.recordPublish(eventName);
                // wave26-c — record the actual publisher for attribution tracking.
                const actualProducer = envelope.metadata.producer;
                if (actualProducer && this.attribution) {
                    this.attribution.record(eventName, actualProducer);
                }
                // Phase E8 — also surface the observation on the live-flow tap.
                const entry = this.registry.get(eventName);
                if (entry) {
                    tap_emitter_js_1.tapEmitter.publish({
                        eventName,
                        namespace: entry.namespace,
                        producer: actualProducer ?? (Array.isArray(entry.producer) ? entry.producer[0] : entry.producer),
                        transport: 'signal',
                        timestamp: new Date().toISOString(),
                        channel: typeof entry.channel === 'string' ? entry.channel : eventName,
                        envelope,
                    });
                }
            });
            this.signalUnsubscribes.set(eventName, unsub);
            // The count is the registry's registered consumers, nothing else.
            // It used to be `length + 1`, which counted the observer's OWN
            // Redis subscription — an internal implementation detail — so the
            // admin UI reported one consumer more than exist, and an event
            // with none at all looked like it had one.
            this.refreshSubscriberCount(eventName);
        }
        catch (err) {
            this.metrics.recordError(eventName);
            this.maybePoison(eventName);
            console.warn(`[metrics-observer] failed to observe signal channel "${eventName}":`, err.message);
        }
    }
    maybePoison(eventName) {
        if (!this.poisonDetector)
            return;
        const becamePoison = this.poisonDetector.recordFailure(eventName);
        if (becamePoison) {
            const entry = this.registry.get(eventName);
            audit_emitter_js_1.auditEmitter.publish({
                kind: 'event.poisoned',
                timestamp: new Date().toISOString(),
                eventName,
                namespace: entry?.namespace ?? 'unknown',
                version: entry?.version ?? 0,
            });
            console.warn(`[event-catalog] event "${eventName}" marked poisoned — exceeded failure threshold`);
        }
    }
    async pollDurableStats() {
        if (this.polling)
            return;
        this.polling = true;
        try {
            await this.pruneRemovedSubscriptions();
            await this.pollDurableStatsOnce();
        }
        finally {
            this.polling = false;
        }
    }
    async pollDurableStatsOnce() {
        // Include transport:'both' — its durable side has the same SQS-style
        // counters as a pure 'durable' event. The registry's transport filter
        // is strict equality, so we widen here rather than calling list()
        // twice.
        const durableEvents = this.registry
            .list()
            .filter(e => e.transport === 'durable' || e.transport === 'both');
        // Drop baselines for events the registry no longer holds (deleted,
        // or re-declared onto a signal-only transport). Nothing else ever
        // removes from these maps, so without this they retain an entry per
        // event name the service has ever seen — and event names arrive from
        // HTTP, where `POST /api/events/bulk` takes 1000 at a time.
        const live = new Set(durableEvents.map(e => e.name));
        for (const name of this.lastDurableSent.keys()) {
            if (!live.has(name))
                this.lastDurableSent.delete(name);
        }
        for (const name of this.lastDurableFailed.keys()) {
            if (!live.has(name))
                this.lastDurableFailed.delete(name);
        }
        for (const entry of durableEvents) {
            const queueName = durable_js_1.DurableTransport.eventNameToQueueName(entry.name);
            const attrs = await this.durable.getQueueAttributes(queueName);
            if (attrs) {
                this.metrics.updateDurableStats(entry.name, {
                    queueDepth: typeof attrs['ApproximateNumberOfMessages'] === 'number'
                        ? attrs['ApproximateNumberOfMessages'] : undefined,
                    messagesInFlight: typeof attrs['ApproximateNumberOfMessagesNotVisible'] === 'number'
                        ? attrs['ApproximateNumberOfMessagesNotVisible'] : undefined,
                    // `oldestMessageAge` is declared on EventStats and gauged by
                    // MetricsCollector but was never populated, so it read 0 —
                    // i.e. "nothing is stuck" — for every queue forever. Depth
                    // alone does not distinguish a busy queue from a wedged one;
                    // the age of the head does.
                    oldestMessageAge: typeof attrs['ApproximateAgeOfOldestMessage'] === 'number'
                        ? attrs['ApproximateAgeOfOldestMessage'] : undefined,
                });
            }
            const transportMetrics = this.durable.getMetrics(queueName);
            if (transportMetrics) {
                // Counter-reset handling. The transport's `sent`/`failed` are
                // process-lifetime counters on the DurableTransport instance; a
                // reconnect or a swapped transport restarts them at 0. The old
                // code only advanced the baseline when the new value was HIGHER,
                // so after a reset every publish was silently dropped on the
                // floor until the counter climbed back past the stale high-water
                // mark — an outage-shaped gap in the publish rate caused by the
                // recovery, not by the incident. Treat a decrease as a reset and
                // re-baseline at the observed value.
                const rawSentBaseline = this.lastDurableSent.get(entry.name) ?? 0;
                const seenBefore = transportMetrics.sent < rawSentBaseline ? 0 : rawSentBaseline;
                // Bound the catch-up loop. A first poll against a long-running
                // transport, or a reset, can produce an enormous delta; each
                // iteration emits a tap frame to every SSE subscriber, so an
                // unbounded loop here is a self-inflicted stall.
                const newSends = Math.min(transportMetrics.sent - seenBefore, MAX_CATCHUP_PER_POLL);
                for (let i = 0; i < newSends; i++) {
                    this.metrics.recordPublish(entry.name);
                    // Phase E8 — durable taps are coarse: one tap event per
                    // observed publish delta. No envelope visibility on this
                    // path (we only see the queue's sent counter rise).
                    tap_emitter_js_1.tapEmitter.publish({
                        eventName: entry.name,
                        namespace: entry.namespace,
                        producer: Array.isArray(entry.producer) ? entry.producer[0] : entry.producer,
                        transport: 'durable',
                        timestamp: new Date().toISOString(),
                        queue: queueName,
                    });
                }
                this.lastDurableSent.set(entry.name, transportMetrics.sent);
                const rawFailedBaseline = this.lastDurableFailed.get(entry.name) ?? 0;
                const prevErrors = transportMetrics.failed < rawFailedBaseline ? 0 : rawFailedBaseline;
                const newErrors = Math.min(transportMetrics.failed - prevErrors, MAX_CATCHUP_PER_POLL);
                for (let i = 0; i < newErrors; i++) {
                    this.metrics.recordError(entry.name);
                    this.maybePoison(entry.name);
                }
                this.lastDurableFailed.set(entry.name, transportMetrics.failed);
            }
        }
    }
}
exports.MetricsObserver = MetricsObserver;
//# sourceMappingURL=metrics-observer.js.map