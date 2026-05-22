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
    record(eventName, actualProducer) {
        let producers = this.observed.get(eventName);
        if (!producers) {
            producers = new Set();
            this.observed.set(eventName, producers);
        }
        producers.add(actualProducer);
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