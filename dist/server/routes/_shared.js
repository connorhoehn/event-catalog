"use strict";
// src/server/routes/_shared.ts
//
// Shared types + mechanical helpers for the /api route modules.
//
// `RoutesDeps` lives here (rather than in routes.ts) so every route
// module can import it without a cycle back through the barrel. The
// helpers below are literal de-duplications of boilerplate that was
// repeated verbatim across the handlers — response envelopes, query
// coercion, SSE preamble — with no behavior change.
Object.defineProperty(exports, "__esModule", { value: true });
exports.eventNotFound = eventNotFound;
exports.badRequest = badRequest;
exports.stringParam = stringParam;
exports.openSseStream = openSseStream;
exports.startSseHeartbeat = startSseHeartbeat;
/** 404 envelope used by every handler that resolves an event by name. */
function eventNotFound(res, name) {
    res.status(404).json({ error: `Event "${name}" not found` });
}
/** 400 envelope used by the request-validation guards. */
function badRequest(res, message) {
    res.status(400).json({ error: message });
}
/**
 * Coerce a query param to a single string, dropping the repeated-key
 * array form. Mirrors the `typeof x === 'string' ? x : undefined`
 * guard the handlers were written with.
 */
function stringParam(req, key) {
    const value = req.query[key];
    return typeof value === 'string' ? value : undefined;
}
/**
 * Write the SSE preamble headers and flush them. Shared by /api/flow
 * and /api/audit; the `X-Accel-Buffering` header defeats nginx /
 * proxies that otherwise buffer SSE responses.
 */
function openSseStream(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
}
/** Heartbeat every 30s to prevent intermediaries from idle-timing out. */
function startSseHeartbeat(res) {
    return setInterval(() => {
        res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    }, 30_000);
}
//# sourceMappingURL=_shared.js.map