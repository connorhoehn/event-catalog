"use strict";
// src/server/routes/flow.ts
//
// Phase E8 — live flow tap (SSE). Subscribers stream every observed
// event publish through the catalog's MetricsObserver, optionally
// filtered. Sample knob (`?sample=N`) emits 1-in-N events for high-
// volume namespaces; default is unfiltered.
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFlowHandlers = createFlowHandlers;
const tap_emitter_js_1 = require("../tap-emitter.js");
const sse_js_1 = require("../sse.js");
const _shared_js_1 = require("./_shared.js");
/**
 * Narrow a raw `?transport=` value to the tap's transport union. Anything
 * else — an unknown value, or the repeated-key array form — yields
 * `undefined`, i.e. "no transport filter". This route documents an
 * unrecognized filter as ignored rather than rejected (unlike
 * `GET /api/events`), because an SSE client that mistypes a filter is
 * better served by an open stream than a 400 it never reads.
 */
function tapTransport(raw) {
    return raw === 'signal' || raw === 'durable' ? raw : undefined;
}
function createFlowHandlers(_deps) {
    function stream(req, res) {
        const filter = {
            eventName: (0, _shared_js_1.stringParam)(req, 'eventName'),
            transport: tapTransport(req.query.transport),
            producer: (0, _shared_js_1.stringParam)(req, 'producer'),
            namespace: (0, _shared_js_1.stringParam)(req, 'namespace'),
        };
        const sampleN = Math.max(1, parseInt((0, _shared_js_1.stringParam)(req, 'sample') ?? '1', 10) || 1);
        let counter = 0;
        let stream = null;
        const handler = (event) => {
            if (!stream)
                return;
            if (!(0, tap_emitter_js_1.matchesTapFilter)(event, filter))
                return;
            counter += 1;
            if (counter % sampleN !== 0)
                return;
            // SSE frame; one event per data line.
            stream.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        // The registry answers 503 itself when the process is at its
        // concurrent-stream ceiling, and detaches the listener below on
        // disconnect, backlog drop, or shutdown.
        stream = sse_js_1.sseRegistry.open(req, res, () => {
            tap_emitter_js_1.tapEmitter.off('publish', handler);
        });
        if (!stream)
            return;
        // Opening comment lets clients know the stream is live even before
        // the first event arrives.
        stream.write(`: connected; filter=${JSON.stringify(filter)}; sample=${sampleN}\n\n`);
        tap_emitter_js_1.tapEmitter.on('publish', handler);
    }
    return { stream };
}
//# sourceMappingURL=flow.js.map