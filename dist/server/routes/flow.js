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
        (0, _shared_js_1.openSseStream)(res);
        // Opening comment lets clients know the stream is live even before
        // the first event arrives.
        res.write(`: connected; filter=${JSON.stringify(filter)}; sample=${sampleN}\n\n`);
        let counter = 0;
        const handler = (event) => {
            if (!(0, tap_emitter_js_1.matchesTapFilter)(event, filter))
                return;
            counter += 1;
            if (counter % sampleN !== 0)
                return;
            // SSE frame; one event per data line.
            res.write(`data: ${JSON.stringify(event)}\n\n`);
        };
        tap_emitter_js_1.tapEmitter.on('publish', handler);
        const heartbeat = (0, _shared_js_1.startSseHeartbeat)(res);
        req.on('close', () => {
            tap_emitter_js_1.tapEmitter.off('publish', handler);
            clearInterval(heartbeat);
        });
    }
    return { stream };
}
//# sourceMappingURL=flow.js.map