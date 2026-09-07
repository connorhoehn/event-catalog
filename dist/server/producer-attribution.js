"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProducerAttributionStore = void 0;
/**
 * wave26-c — tracks which service names have *actually* published each event,
 * separate from the declared producer field. Surfaces undeclared producers
 * (publishing to an event they don't own) and dead declared producers
 * (declared but never published).
 */
class ProducerAttributionStore {
    observed = new Map();
    droppedEvents = 0;
    droppedProducers = 0;
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
    maxEvents;
    maxProducersPerEvent;
    constructor(opts = {}) {
        this.maxEvents = opts.maxEvents ?? 5000;
        this.maxProducersPerEvent = opts.maxProducersPerEvent ?? 100;
    }
    record(eventName, actualProducer) {
        let producers = this.observed.get(eventName);
        if (!producers) {
            if (this.observed.size >= this.maxEvents) {
                const oldest = this.observed.keys().next();
                if (!oldest.done) {
                    this.observed.delete(oldest.value);
                    this.droppedEvents++;
                }
            }
            producers = new Set();
            this.observed.set(eventName, producers);
        }
        if (!producers.has(actualProducer) && producers.size >= this.maxProducersPerEvent) {
            const oldest = producers.values().next();
            if (!oldest.done) {
                producers.delete(oldest.value);
                this.droppedProducers++;
            }
        }
        producers.add(actualProducer);
    }
    /** Eviction counters, so a capped store never looks like a quiet one. */
    getOverflowStats() {
        return {
            events: this.observed.size,
            droppedEvents: this.droppedEvents,
            droppedProducers: this.droppedProducers,
        };
    }
    /** Drop attribution for an event that no longer exists. */
    forget(eventName) {
        this.observed.delete(eventName);
    }
    getObserved(eventName) {
        return [...(this.observed.get(eventName) ?? [])];
    }
    getAll() {
        const result = {};
        for (const [name, producers] of this.observed) {
            result[name] = [...producers];
        }
        return result;
    }
    clear() {
        this.observed.clear();
    }
}
exports.ProducerAttributionStore = ProducerAttributionStore;
//# sourceMappingURL=producer-attribution.js.map