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
exports.isJsonObject = isJsonObject;
exports.jsonBody = jsonBody;
exports.singleParam = singleParam;
exports.enumParam = enumParam;
exports.resolveParams = resolveParams;
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