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
exports.RouteLog = exports.ROUTE_LOGS_PER_WINDOW = exports.ROUTE_LOG_WINDOW_MS = void 0;
exports.eventNotFound = eventNotFound;
exports.badRequest = badRequest;
exports.stringParam = stringParam;
exports.isJsonObject = isJsonObject;
exports.jsonBody = jsonBody;
exports.singleParam = singleParam;
exports.enumParam = enumParam;
exports.resolveParams = resolveParams;
exports.openSseStream = openSseStream;
exports.startSseHeartbeat = startSseHeartbeat;
const bounded_js_1 = require("../../utils/bounded.js");
const logger_js_1 = require("../../utils/logger.js");
/**
 * Default rate ceiling for handler diagnostics.
 *
 * Every warning a route handler emits is by definition on a per-request
 * path, and the admin API is unauthenticated by default — so each of
 * them is a log source an arbitrary caller can drive at line rate. A
 * single client looping `GET /api/events/x/history` against a down Redis
 * writes one line per request, forever.
 *
 * Ten a minute per key is enough to see what is failing and how often
 * (the suppressed count rides on the line); the metrics and the 503s are
 * the volume-independent signal.
 */
exports.ROUTE_LOG_WINDOW_MS = 60_000;
exports.ROUTE_LOGS_PER_WINDOW = 10;
/**
 * Throttled, structured diagnostics for a route module.
 *
 * One instance per handler factory, so the key space is scoped to a
 * route family and a noisy `/history` cannot suppress a `/dlq` line.
 * Keys must be derived from something bounded — a route name plus at
 * most an event name — because they are the throttle's dedupe key and
 * event names arrive from HTTP; `maxKeys` bounds the damage regardless.
 */
class RouteLog {
    log;
    throttle;
    constructor(logger, options = {}) {
        this.log = new logger_js_1.LogWriter(logger);
        this.throttle = new bounded_js_1.LogThrottle({
            keyIntervalMs: exports.ROUTE_LOG_WINDOW_MS,
            maxPerWindow: exports.ROUTE_LOGS_PER_WINDOW,
            maxKeys: 128,
            ...options,
        });
    }
    /**
     * Emit one line unless the throttle says otherwise.
     *
     * `tail` is what the call site used to pass as extra `console.warn`
     * arguments; it is forwarded verbatim on the default console sink and
     * is always also present in `fields`, so an injected sink loses
     * nothing. The suppressed-count suffix goes *before* a trailing colon
     * so `… failed (+3 similar suppressed): detail` still reads correctly,
     * and is the empty string — hence byte-identical output — when nothing
     * was suppressed.
     */
    warn(key, message, fields, ...tail) {
        const suppressed = this.throttle.attempt(key);
        if (suppressed === null)
            return;
        const suffix = bounded_js_1.LogThrottle.suffix(suppressed);
        const text = message.endsWith(':')
            ? message.slice(0, -1) + suffix + ':'
            : message + suffix;
        this.log.warn(text, { ...fields, suppressed }, ...tail);
    }
}
exports.RouteLog = RouteLog;
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
 *
 * Use this only where silently ignoring a malformed param is the
 * documented contract (the SSE filters). Everywhere else prefer
 * {@link singleParam}, which reports the array form instead of
 * quietly widening the result set.
 */
function stringParam(req, key) {
    const value = req.query[key];
    return typeof value === 'string' ? value : undefined;
}
// ─── Request body ────────────────────────────────────────────────────────────
//
// `req.body` is `unknown` — it is whatever JSON.parse returned. Handlers used
// to reach into it with `req.body?.x`, which TypeScript resolves against `{}`
// and rejects. These two narrow it once, at the edge, so handlers work with a
// real type instead of a cast.
/** True for a plain JSON object (not null, not an array). */
function isJsonObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
/** The parsed JSON body when it is an object, else undefined. */
function jsonBody(req) {
    return isJsonObject(req.body) ? req.body : undefined;
}
/**
 * Read a query param as a single string. Repeated keys are rejected;
 * a present-but-empty value is treated as absent (a bare `?tag=` should
 * not filter on the empty string).
 */
function singleParam(req, key) {
    const raw = req.query[key];
    if (raw === undefined)
        return { ok: true, value: undefined };
    if (typeof raw !== 'string') {
        return { ok: false, error: `${key} must be a single value` };
    }
    const trimmed = raw.trim();
    return { ok: true, value: trimmed === '' ? undefined : trimmed };
}
/**
 * Read a query param constrained to a fixed set of values, narrowing the
 * result to the union type rather than casting. Rejects both the repeated
 * key form and out-of-set values.
 */
function enumParam(req, key, allowed) {
    const single = singleParam(req, key);
    if (!single.ok)
        return single;
    const value = single.value;
    if (value === undefined)
        return { ok: true, value: undefined };
    if (!allowed.includes(value)) {
        return { ok: false, error: `${key} must be one of: ${allowed.join(', ')}` };
    }
    return { ok: true, value: value };
}
/**
 * Resolve a set of guards, writing a 400 and returning null on the first
 * failure. Lets a handler collapse five guards into one early return:
 *
 *   const q = resolveParams(res, { transport: enumParam(...), tag: singleParam(...) });
 *   if (!q) return;
 */
function resolveParams(res, guards) {
    const out = {};
    for (const [key, result] of Object.entries(guards)) {
        if (!result.ok) {
            badRequest(res, result.error);
            return null;
        }
        out[key] = result.value;
    }
    return out;
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