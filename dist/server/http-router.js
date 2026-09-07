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
exports.makeRouteResponse = makeRouteResponse;
exports.Router = Router;
exports.stripPrefix = stripPrefix;
exports.dispatchMounts = dispatchMounts;
exports.createRequestListener = createRequestListener;
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
function makeRouteResponse(nodeRes) {
    let statusCode = 200;
    const res = {
        status(code) {
            statusCode = code;
            return res;
        },
        json(body) {
            if (nodeRes.headersSent)
                return;
            const payload = JSON.stringify(body);
            nodeRes.setHeader('Content-Type', 'application/json');
            nodeRes.writeHead(statusCode);
            nodeRes.end(payload);
        },
        send(body) {
            if (nodeRes.headersSent)
                return;
            nodeRes.writeHead(statusCode);
            nodeRes.end(body);
        },
        setHeader(name, value) {
            if (!nodeRes.headersSent)
                nodeRes.setHeader(name, value);
        },
        write(chunk) {
            if (!nodeRes.headersSent)
                nodeRes.writeHead(statusCode);
            return nodeRes.write(chunk);
        },
        end(body) {
            nodeRes.end(body);
        },
        flushHeaders() {
            if (!nodeRes.headersSent) {
                nodeRes.writeHead(statusCode);
                nodeRes.flushHeaders();
            }
        },
        get headersSent() {
            return nodeRes.headersSent;
        },
        raw: nodeRes,
    };
    return res;
}
class HttpRouter {
    routes = [];
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
                console.warn(`[http-router] handler error on ${req.method} ${req.path}:`, err instanceof Error ? err.message : String(err));
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
function Router() {
    return new HttpRouter();
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
/**
 * Build a plain `http.RequestListener` over a set of mounts — buffers +
 * JSON-parses the body itself. This is the unit-test harness (supertest
 * accepts a listener directly); production traffic instead arrives
 * through distributed-core's AdmissionHttpServer, which does its own
 * bounded body read before `startServer`'s onRequest builds the same
 * req/res adapters.
 */
function createRequestListener(...mounts) {
    return (nodeReq, nodeRes) => {
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
                const req = makeRouteRequest(nodeReq, body);
                const res = makeRouteResponse(nodeRes);
                const handled = await dispatchMounts(req, res, mounts);
                if (!handled && !nodeRes.headersSent) {
                    nodeRes.writeHead(404, { 'Content-Type': 'application/json' });
                    nodeRes.end(JSON.stringify({ error: 'NotFound', path: req.path }));
                }
            })();
        });
    };
}
//# sourceMappingURL=http-router.js.map