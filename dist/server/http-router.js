"use strict";
// src/server/http-router.ts
//
// Minimal HTTP router + request/response adapters for the admin server.
//
// Why this exists: the platform standard is distributed-core's HTTP
// transport (`AdmissionHttpServer` from `distributed-core/server`), not
// Express. AdmissionHttpServer hands consumers ONE `onRequest(req, res)`
// callback with a pre-buffered body and normalized send helpers — it has
// no route table, because routing is application concern. This module is
// that application concern: `:param` path matching and express-shaped
// `req`/`res` adapters, so the ~45 route handlers in routes.ts /
// bundle-routes.ts kept their bodies verbatim through the Express
// removal. Zero dependencies beyond node:http types.
//
// It deliberately implements ONLY the surface those handlers actually
// use — req.params / req.query / req.body / req.header() / req.on(),
// res.status().json() / res.setHeader() / res.write() / res.end() /
// res.send() / res.flushHeaders() — and nothing more. If a new handler
// needs more, extend the adapter here rather than reaching for a
// framework.
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpRouter = void 0;
exports.parseQuery = parseQuery;
exports.makeRouteRequest = makeRouteRequest;
exports.compressionFor = compressionFor;
exports.makeRouteResponse = makeRouteResponse;
exports.Router = Router;
exports.stripPrefix = stripPrefix;
exports.dispatchMounts = dispatchMounts;
exports.createRequestListener = createRequestListener;
const compression_js_1 = require("./compression.js");
const bounded_js_1 = require("../utils/bounded.js");
const logger_js_1 = require("../utils/logger.js");
// ─── Adapters ────────────────────────────────────────────────────────────────
function parseQuery(rawUrl) {
    const q = rawUrl.indexOf('?');
    const out = {};
    if (q === -1)
        return out;
    for (const [key, value] of new URLSearchParams(rawUrl.slice(q + 1))) {
        const existing = out[key];
        if (existing === undefined)
            out[key] = value;
        else if (Array.isArray(existing))
            existing.push(value);
        else
            out[key] = [existing, value];
    }
    return out;
}
function makeRouteRequest(nodeReq, body) {
    const rawUrl = nodeReq.url ?? '/';
    const path = rawUrl.split('?')[0];
    return {
        method: (nodeReq.method ?? 'GET').toUpperCase(),
        path,
        params: {},
        query: parseQuery(rawUrl),
        body,
        header(name) {
            const v = nodeReq.headers[name.toLowerCase()];
            return Array.isArray(v) ? v[0] : v;
        },
        on(event, listener) {
            nodeReq.on(event, listener);
        },
        raw: nodeReq,
    };
}
/**
 * Build the compression context for a request. Returns undefined when
 * compression is off, so the response path keeps its old shape exactly.
 */
function compressionFor(nodeReq, config) {
    if (config === undefined || !config.enabled)
        return undefined;
    const raw = nodeReq.headers['accept-encoding'];
    const header = Array.isArray(raw) ? raw.join(', ') : raw;
    return { config, encoding: (0, compression_js_1.negotiateEncoding)(header, config.encodings) };
}
/**
 * Add a field name to `Vary` without clobbering what is already there —
 * `startServer` sets `Vary: Origin` for CORS, and overwriting it would
 * let a shared cache serve one origin's response to another.
 */
function appendVary(nodeRes, field) {
    const existing = nodeRes.getHeader('Vary');
    if (existing === undefined) {
        nodeRes.setHeader('Vary', field);
        return;
    }
    const current = Array.isArray(existing) ? existing.join(', ') : String(existing);
    if (current.trim() === '*')
        return;
    const present = current
        .split(',')
        .some(part => part.trim().toLowerCase() === field.toLowerCase());
    if (!present)
        nodeRes.setHeader('Vary', `${current}, ${field}`);
}
function contentTypeOf(nodeRes) {
    const raw = nodeRes.getHeader('Content-Type');
    if (raw === undefined)
        return undefined;
    return Array.isArray(raw) ? raw[0] : String(raw);
}
/** 1xx / 204 / 304 must carry neither a body nor a Content-Length. */
function bodyForbidden(status) {
    return status < 200 || status === 204 || status === 304;
}
function makeRouteResponse(nodeRes, compression) {
    let statusCode = 200;
    /**
     * Latched by `flushHeaders()` / `write()` — i.e. by the SSE routes and
     * nothing else. Once a response is a stream, buffering it through a
     * compressor would hold frames back until the stream ended, which for
     * `/api/flow` and `/api/audit` means forever. A stream is never
     * compressed, and the flag also stops a trailing `end(body)` from
     * quietly re-entering the buffered path mid-stream.
     */
    let streaming = false;
    /**
     * The one place a complete body leaves this process: negotiate, maybe
     * compress, then set a Content-Length that matches the bytes actually
     * written. A stale Content-Length is a framing error that hangs
     * clients, so it is computed here and nowhere else.
     */
    const finish = (body) => {
        // The peer is gone. Everything below — the brotli/gzip pass most of
        // all — would produce bytes with nowhere to go.
        //
        // Compression here is whole-buffer and synchronous, so it is event-loop
        // time, not background time: `GET /api/events` is ~326 KiB of JSON, and
        // a client that sends `Accept-Encoding: br` and then resets still paid
        // for a full brotli pass over all of it. That is the cheapest possible
        // request to issue and one of the more expensive ones to serve, which
        // makes it the shape an abusive client would pick deliberately. Gating
        // on `headersSent` alone never caught it: a reset destroys the socket
        // without sending any headers, so `headersSent` is still false and the
        // work went ahead exactly as if someone were waiting for it.
        if (nodeRes.destroyed)
            return;
        if (bodyForbidden(statusCode)) {
            nodeRes.writeHead(statusCode);
            nodeRes.end();
            return;
        }
        // Kept as the original string on the identity path — a Buffer round
        // trip would be a pointless copy of every response body the server
        // sends, and the pre-compression behavior is byte-for-byte preserved.
        let payload = body ?? '';
        let length = typeof payload === 'string'
            ? Buffer.byteLength(payload, 'utf8')
            : payload.length;
        if (compression !== undefined) {
            // Vary goes on every response that COULD have been compressed, not
            // just the ones that were: a shared cache keying only on the URL
            // would otherwise hand a gzipped body to a client that asked for
            // identity (or vice versa).
            appendVary(nodeRes, 'Accept-Encoding');
            const chosen = (0, compression_js_1.chooseCompression)(compression.config, compression.encoding, contentTypeOf(nodeRes), length);
            if (chosen !== null) {
                const raw = typeof payload === 'string' ? Buffer.from(payload, 'utf8') : payload;
                payload = (0, compression_js_1.compressBody)(raw, chosen, compression.config.level);
                length = payload.length;
                nodeRes.setHeader('Content-Encoding', chosen);
            }
        }
        // Recomputed from the bytes actually about to be written. A
        // Content-Length describing the pre-compression body is a framing
        // error: the peer waits forever for bytes that never come.
        nodeRes.setHeader('Content-Length', String(length));
        nodeRes.writeHead(statusCode);
        nodeRes.end(payload);
    };
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(body) {
            // `destroyed` is checked here as well as in finish() because
            // JSON.stringify runs *before* the call: for the bulk export
            // archive that is a multi-hundred-KiB serialization of the whole
            // registry, and doing it for a peer that has already gone is the
            // same wasted synchronous work as the compression pass.
            if (nodeRes.headersSent || nodeRes.destroyed)
                return;
            nodeRes.setHeader('Content-Type', 'application/json');
            finish(JSON.stringify(body));
        },
        send(body) {
            if (nodeRes.headersSent || nodeRes.destroyed)
                return;
            finish(body);
        },
        setHeader(name, value) {
            if (!nodeRes.headersSent)
                nodeRes.setHeader(name, value);
        },
        write(chunk) {
            streaming = true;
            if (!nodeRes.headersSent)
                nodeRes.writeHead(statusCode);
            return nodeRes.write(chunk);
        },
        end(body) {
            if (streaming || nodeRes.headersSent || body === undefined) {
                nodeRes.end(body);
                return;
            }
            finish(body);
        },
        flushHeaders() {
            streaming = true;
            if (!nodeRes.headersSent) {
                nodeRes.writeHead(statusCode);
                nodeRes.flushHeaders();
            }
        },
        get headersSent() {
            return nodeRes.headersSent;
        },
        get destroyed() {
            return nodeRes.destroyed;
        },
        raw: nodeRes,
    };
    return res;
}
/**
 * Rate ceiling on the uncaught-handler warning.
 *
 * This is the definitive per-request log path: one line for every
 * request whose handler throws, on a surface an unauthenticated caller
 * can drive as fast as it likes. A handler that throws on a malformed
 * body throws for every retry of that body. Keyed by `METHOD path` so
 * one broken route cannot hide another, and capped per window so a
 * caller cycling paths cannot use the key space to get around it.
 */
const HANDLER_ERROR_WINDOW_MS = 60_000;
const HANDLER_ERRORS_PER_WINDOW = 10;
class HttpRouter {
    routes = [];
    log;
    handlerErrors = new bounded_js_1.LogThrottle({
        keyIntervalMs: HANDLER_ERROR_WINDOW_MS,
        maxPerWindow: HANDLER_ERRORS_PER_WINDOW,
        maxKeys: 256,
    });
    /**
     * @param logger diagnostics sink for uncaught handler errors. Omitted,
     *   they go to `console.warn` exactly as before.
     */
    constructor(logger) {
        this.log = new logger_js_1.LogWriter(logger);
    }
    get(path, handler) { return this.add('GET', path, handler); }
    post(path, handler) { return this.add('POST', path, handler); }
    put(path, handler) { return this.add('PUT', path, handler); }
    patch(path, handler) { return this.add('PATCH', path, handler); }
    delete(path, handler) { return this.add('DELETE', path, handler); }
    add(method, path, handler) {
        this.routes.push({ method, segments: splitPath(path), handler });
        return this;
    }
    /**
     * Dispatch `req` against the route table using `pathname` (the path
     * AFTER any mount prefix has been stripped — '' or '/' for the mount
     * root). Returns true when a route matched (whether or not its handler
     * has responded yet), false when nothing matched so the caller can
     * fall through. Handler errors send a 500 unless headers are already
     * out (mid-SSE), and never propagate.
     */
    async handle(req, res, pathname) {
        const incoming = splitPath(pathname);
        for (const route of this.routes) {
            if (route.method !== req.method)
                continue;
            const params = matchSegments(route.segments, incoming);
            if (params === null)
                continue;
            req.params = params;
            try {
                await route.handler(req, res);
            }
            catch (err) {
                const detail = (0, logger_js_1.errorMessage)(err);
                const suppressed = this.handlerErrors.attempt(`${req.method} ${req.path}`);
                if (suppressed !== null) {
                    this.log.warn(`[http-router] handler error on ${req.method} ${req.path}`
                        + bounded_js_1.LogThrottle.suffix(suppressed) + ':', {
                        component: 'http-router',
                        method: req.method,
                        path: req.path,
                        status: res.headersSent ? undefined : 500,
                        error: detail,
                        suppressed,
                    }, detail);
                }
                if (!res.headersSent) {
                    res.status(500).json({ error: 'InternalServerError' });
                }
            }
            return true;
        }
        return false;
    }
}
exports.HttpRouter = HttpRouter;
/** Express-style factory so route modules read `const router = Router()`. */
function Router(logger) {
    return new HttpRouter(logger);
}
function splitPath(path) {
    return path.split('/').filter(s => s.length > 0);
}
/** Match pattern segments against incoming segments; null = no match. */
function matchSegments(pattern, incoming) {
    if (pattern.length !== incoming.length)
        return null;
    const params = {};
    for (let i = 0; i < pattern.length; i++) {
        const p = pattern[i];
        if (p.startsWith(':')) {
            try {
                params[p.slice(1)] = decodeURIComponent(incoming[i]);
            }
            catch {
                params[p.slice(1)] = incoming[i];
            }
        }
        else if (p !== incoming[i]) {
            return null;
        }
    }
    return params;
}
/**
 * Strip `prefix` off `path`. Returns the sub-path ('/' for an exact
 * prefix hit) or null when `path` isn't under `prefix`. '' or '/' as
 * prefix matches everything.
 */
function stripPrefix(path, prefix) {
    if (prefix === '' || prefix === '/')
        return path;
    if (path === prefix)
        return '/';
    if (path.startsWith(prefix + '/'))
        return path.slice(prefix.length);
    return null;
}
/**
 * Dispatch a prepared req/res pair across mounts in order (longest
 * prefix should be listed first when mounts nest). Returns true when
 * some router handled the request.
 */
async function dispatchMounts(req, res, mounts) {
    for (const [prefix, router] of mounts) {
        const sub = stripPrefix(req.path, prefix);
        if (sub === null)
            continue;
        if (await router.handle(req, res, sub))
            return true;
    }
    return false;
}
function createRequestListener(first, ...rest) {
    // A Mount is a tuple (an array); the options object is not.
    const options = Array.isArray(first) || first === undefined
        ? {}
        : first;
    const mounts = Array.isArray(first) ? [first, ...rest] : rest;
    const run = async (nodeReq, nodeRes, body) => {
        const req = makeRouteRequest(nodeReq, body);
        const res = makeRouteResponse(nodeRes, compressionFor(nodeReq, options.compression));
        const handled = await dispatchMounts(req, res, mounts);
        if (!handled && !nodeRes.headersSent) {
            nodeRes.writeHead(404, { 'Content-Type': 'application/json' });
            nodeRes.end(JSON.stringify({ error: 'NotFound', path: req.path }));
        }
    };
    return (nodeReq, nodeRes) => {
        const method = (nodeReq.method ?? 'GET').toUpperCase();
        // GET/HEAD carry no body, and consuming the request stream anyway is
        // not neutral: reading it to 'end' lets Node auto-destroy the
        // IncomingMessage, which fires `req.on('close')` immediately — and
        // that is the exact signal `sseRegistry.open()` uses to tear a stream
        // down. A /api/flow opened through this harness would detach its tap
        // listener milliseconds after connecting and then sit there silently.
        // AdmissionHttpServer likewise reads no body for GET/HEAD, so
        // skipping it here is also what makes the harness match production.
        if (method === 'GET' || method === 'HEAD') {
            void run(nodeReq, nodeRes, undefined);
            return;
        }
        const chunks = [];
        nodeReq.on('data', (c) => chunks.push(c));
        nodeReq.on('end', () => {
            void (async () => {
                let body;
                const text = Buffer.concat(chunks).toString('utf8');
                if (text.length > 0) {
                    try {
                        body = JSON.parse(text);
                    }
                    catch {
                        nodeRes.writeHead(400, { 'Content-Type': 'application/json' });
                        nodeRes.end(JSON.stringify({ error: 'InvalidJson' }));
                        return;
                    }
                }
                await run(nodeReq, nodeRes, body);
            })();
        });
    };
}
//# sourceMappingURL=http-router.js.map