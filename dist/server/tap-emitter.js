"use strict";
// src/server/tap-emitter.ts
//
// Phase E8 — live flow tap.
//
// Process-internal EventEmitter that publishes a per-event "I saw this
// flow" notification. The SSE endpoint at GET /api/flow listens on this
// emitter and streams filtered events to admin-UI clients.
//
// Wired from `MetricsObserver`'s existing signal subscription path
// (which already sees every signal envelope flowing through declared
// channels). Durable observations are coarser — emitted from the
// polling loop when `sent` counters rise — and carry no payload.
Object.defineProperty(exports, "__esModule", { value: true });
exports.tapEmitter = void 0;
exports.matchesTapFilter = matchesTapFilter;
const node_events_1 = require("node:events");
/**
 * Apply a TapFilter to a TapEvent. Exported for testability — the route
 * uses the same predicate.
 */
function matchesTapFilter(event, filter) {
    if (filter.eventName && event.eventName !== filter.eventName)
        return false;
    if (filter.transport && event.transport !== filter.transport)
        return false;
    if (filter.producer && event.producer !== filter.producer)
        return false;
    if (filter.namespace && event.namespace !== filter.namespace)
        return false;
    return true;
}
class TapEmitter extends node_events_1.EventEmitter {
    publish(event) {
        this.emit('publish', event);
    }
}
/**
 * Module-singleton tap emitter. Both the producer side (MetricsObserver
 * + durable poll) and the consumer side (SSE route handler) import this
 * one instance — process-local, no Redis round-trip, no broadcast amp.
 *
 * setMaxListeners(0) — every SSE client adds one listener; we don't
 * want Node's default warning at 10.
 */
exports.tapEmitter = new TapEmitter();
exports.tapEmitter.setMaxListeners(0);
//# sourceMappingURL=tap-emitter.js.map