"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MetricsObserver = void 0;
const durable_js_1 = require("../client/durable.js");
const tap_emitter_js_1 = require("./tap-emitter.js");
const audit_emitter_js_1 = require("./audit-emitter.js");
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
        this.durablePollTimer = setInterval(() => {
            this.pollDurableStats();
        }, this.durablePollIntervalMs);
    }
    async observe(eventName, transport) {
        if (transport === 'signal' || transport === 'both') {
            await this.observeSignal(eventName);
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
            this.metrics.setSubscriberCount(eventName, (this.registry.get(eventName)?.subscribers.length ?? 0) + 1);
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
        // Include transport:'both' — its durable side has the same SQS-style
        // counters as a pure 'durable' event. The registry's transport filter
        // is strict equality, so we widen here rather than calling list()
        // twice.
        const durableEvents = this.registry
            .list()
            .filter(e => e.transport === 'durable' || e.transport === 'both');
        for (const entry of durableEvents) {
            const queueName = durable_js_1.DurableTransport.eventNameToQueueName(entry.name);
            const attrs = await this.durable.getQueueAttributes(queueName);
            if (attrs) {
                this.metrics.updateDurableStats(entry.name, {
                    queueDepth: typeof attrs['ApproximateNumberOfMessages'] === 'number'
                        ? attrs['ApproximateNumberOfMessages'] : undefined,
                    messagesInFlight: typeof attrs['ApproximateNumberOfMessagesNotVisible'] === 'number'
                        ? attrs['ApproximateNumberOfMessagesNotVisible'] : undefined,
                });
            }
            const transportMetrics = this.durable.getMetrics(queueName);
            if (transportMetrics) {
                const seenBefore = this.lastDurableSent.get(entry.name) ?? 0;
                const newSends = transportMetrics.sent - seenBefore;
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
                if (transportMetrics.sent > seenBefore) {
                    this.lastDurableSent.set(entry.name, transportMetrics.sent);
                }
                const prevErrors = this.lastDurableFailed.get(entry.name) ?? 0;
                for (let i = 0; i < transportMetrics.failed - prevErrors; i++) {
                    this.metrics.recordError(entry.name);
                    this.maybePoison(entry.name);
                }
                if (transportMetrics.failed > prevErrors) {
                    this.lastDurableFailed.set(entry.name, transportMetrics.failed);
                }
            }
        }
    }
}
exports.MetricsObserver = MetricsObserver;
//# sourceMappingURL=metrics-observer.js.map