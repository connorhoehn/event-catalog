"use strict";
// src/server/static-compression.ts
//
// Content-coding negotiation for the admin UI's static assets.
//
// The problem: `makeRouteResponse` (http-router.ts) is where every one of
// the ~45 API handlers ends up, so adding gzip/brotli there covered the
// whole JSON surface in one place. The admin UI does not go through it.
// It is served by distributed-core's `serveStatic`, which takes the raw
// `http.ServerResponse` and writes the file to the socket itself:
//
//     const content = fs.readFileSync(filePath);
//     res.writeHead(200, { 'Content-Type': …, 'Cache-Control': … });
//     res.end(content);
//
// So the largest single response this service sends — a 272 KiB graph
// vendor chunk — shipped raw while a 2 KiB JSON body got brotli'd.
//
// Why wrap rather than reimplement: `serveStatic` is small but every line
// of it is a thing that is easy to get subtly wrong — the `startsWith`
// path-traversal check, directory→index.html resolution, the extension→
// MIME table, `no-cache` for HTML vs `immutable` for hashed assets, and
// the true/false contract that lets the caller fall through to the SPA
// handler. Reimplementing it to add one header would be trading a
// 272-KiB download for a directory-traversal bug. It also cannot be
// configured to compress: `ServeStaticOptions` is `{ staticDir,
// mimeOverrides, maxAgeSeconds }` and nothing else.
//
// What it CAN do is be handed a different `res`. `serveStatic` only ever
// calls `writeHead` and `end` on it, so a proxy that records those two
// instead of forwarding them gives us the finished body, status and
// headers *before* anything reaches the socket — at which point this is
// the same negotiate-then-compress step `makeRouteResponse` already
// performs, reusing `compression.ts` verbatim. The proxy forwards every
// other property to the real response, so an upstream `serveStatic` that
// starts calling `setHeader` keeps working, and one that starts
// *streaming* (`write`) is detected and falls back to pass-through
// rather than buffering a stream.
//
// Measured on the real `src/admin/dist` build (node v20+, brotli q5):
//
//   asset                      raw     gzip      br    br cost
//   vendor-graph-*.js       272120    90619   85434     4.4 ms
//   vendor-react-*.js       166647    54434   52162     2.6 ms
//   index-*.js               58031    18038   17101     1.0 ms
//   index-*.css              30919     6964    6705     0.4 ms
//   vendor-graph-*.css       15851     2654    2501     0.2 ms
//   ── whole dist ──        628918   206339  195687
//
// i.e. 629 KiB → 196 KiB, a 68.9% reduction on a first page load.
//
// The 4.4 ms is why {@link StaticCompressionCache} exists. Static assets
// are content-hashed and immutable, so the same bytes are compressed for
// every visitor and every hard refresh; caching the output turns a
// recurring event-loop stall into a one-off. The cache is validated by
// comparing the raw bytes (a ~0.02 ms memcmp against a 4.4 ms brotli
// run), so a rebuild that reuses a filename can never serve stale
// content, and it is bounded in bytes so a large `staticDir` cannot grow
// it without limit.
Object.defineProperty(exports, "__esModule", { value: true });
exports.StaticCompressionCache = exports.DEFAULT_STATIC_CACHE_BYTES = void 0;
exports.sendStaticBuffer = sendStaticBuffer;
exports.withStaticCompression = withStaticCompression;
const compression_js_1 = require("./compression.js");
/**
 * Total bytes (raw + compressed, summed) the variant cache may hold.
 * The whole admin bundle is ~630 KiB raw and ~200 KiB compressed, so
 * 8 MiB is "the build fits, several times over" rather than a tuning
 * knob anyone should need to touch.
 */
exports.DEFAULT_STATIC_CACHE_BYTES = 8 * 1024 * 1024;
/**
 * Insertion-ordered, byte-bounded cache of compressed static variants.
 *
 * Keyed on request path + coding. A hit is only used when the raw bytes
 * still match, so the cache cannot outlive a rebuild — `index.html` is
 * not content-hashed and is the one asset whose bytes change under a
 * stable name.
 */
class StaticCompressionCache {
    maxBytes;
    entries = new Map();
    bytes = 0;
    constructor(maxBytes = exports.DEFAULT_STATIC_CACHE_BYTES) {
        this.maxBytes = maxBytes;
    }
    /** Current occupancy, for tests and diagnostics. */
    get size() { return this.entries.size; }
    get byteLength() { return this.bytes; }
    get(key, raw) {
        const hit = this.entries.get(key);
        if (hit === undefined)
            return undefined;
        // Length first: the cheap rejection for the common rebuild case.
        if (hit.raw.length !== raw.length || !hit.raw.equals(raw)) {
            this.entries.delete(key);
            this.bytes -= hit.raw.length + hit.compressed.length;
            return undefined;
        }
        return hit.compressed;
    }
    /** `key` already encodes the coding, so the variant stores only bytes. */
    set(key, raw, compressed) {
        const cost = raw.length + compressed.length;
        // A single asset larger than the whole budget is simply not cached;
        // evicting everything to hold it would be worse than recompressing.
        if (cost > this.maxBytes)
            return;
        const existing = this.entries.get(key);
        if (existing !== undefined) {
            this.bytes -= existing.raw.length + existing.compressed.length;
            this.entries.delete(key);
        }
        while (this.bytes + cost > this.maxBytes) {
            const oldest = this.entries.keys().next();
            if (oldest.done)
                break;
            const victim = this.entries.get(oldest.value);
            this.entries.delete(oldest.value);
            this.bytes -= victim.raw.length + victim.compressed.length;
        }
        this.entries.set(key, { raw, compressed });
        this.bytes += cost;
    }
    clear() {
        this.entries.clear();
        this.bytes = 0;
    }
}
exports.StaticCompressionCache = StaticCompressionCache;
/** 1xx / 204 / 304 carry neither a body nor a Content-Length. */
function bodyForbidden(status) {
    return status < 200 || status === 204 || status === 304;
}
/**
 * Add a field to `Vary` without clobbering what is already there.
 * `startServer` sets `Vary: Origin` for CORS on the same response.
 *
 * (Deliberately duplicated from the private helper in http-router.ts
 * rather than exported from it: that one operates on the response the
 * router owns, this one on the raw `ServerResponse`, and the six lines
 * are not worth a cross-module coupling between the two paths.)
 */
function appendVary(res, field) {
    const existing = res.getHeader('Vary');
    if (existing === undefined) {
        res.setHeader('Vary', field);
        return;
    }
    const current = Array.isArray(existing) ? existing.join(', ') : String(existing);
    if (current.trim() === '*')
        return;
    const present = current
        .split(',')
        .some(part => part.trim().toLowerCase() === field.toLowerCase());
    if (!present)
        res.setHeader('Vary', `${current}, ${field}`);
}
/** Normalise whatever `writeHead` was handed into a flat header map. */
function collectHeaders(target, headers) {
    if (headers === undefined)
        return;
    if (Array.isArray(headers)) {
        // The raw [name, value, name, value, …] form. `serveStatic` does not
        // use it; handled so the proxy is not a landmine if it starts to.
        for (let i = 0; i + 1 < headers.length; i += 2) {
            target.set(String(headers[i]).toLowerCase(), String(headers[i + 1]));
        }
        return;
    }
    for (const [name, value] of Object.entries(headers)) {
        if (value !== undefined)
            target.set(name.toLowerCase(), value);
    }
}
/**
 * Negotiate + write one fully-buffered static body to the socket.
 *
 * Shared by the `serveStatic` wrapper and the SPA `index.html` fallback,
 * which bypasses `serveStatic` entirely and would otherwise be the one
 * remaining uncompressed path.
 */
function sendStaticBuffer(req, res, status, body, headers, compression, cache) {
    for (const [name, value] of headers) {
        res.setHeader(name, value);
    }
    if (bodyForbidden(status)) {
        res.writeHead(status);
        res.end();
        return;
    }
    let payload = body;
    if (compression !== undefined && compression.enabled) {
        // Vary goes on every response that COULD have been compressed, not
        // only the ones that were — a shared cache keyed on the URL alone
        // would otherwise hand a brotli body to a client that asked for
        // identity. Static assets are served `immutable` with a one-year
        // max-age, so this is the header that keeps that cache honest.
        appendVary(res, 'Accept-Encoding');
        const rawAccept = req.headers['accept-encoding'];
        const accept = Array.isArray(rawAccept) ? rawAccept.join(', ') : rawAccept;
        const encoding = (0, compression_js_1.negotiateEncoding)(accept, compression.encodings);
        const contentTypeHeader = headers.get('content-type');
        const contentType = contentTypeHeader === undefined
            ? undefined
            : String(Array.isArray(contentTypeHeader) ? contentTypeHeader[0] : contentTypeHeader);
        const chosen = (0, compression_js_1.chooseCompression)(compression, encoding, contentType, body.length);
        if (chosen !== null) {
            const key = `${req.url ?? '/'} ${chosen}`;
            const cached = cache?.get(key, body);
            if (cached !== undefined) {
                payload = cached;
            }
            else {
                payload = (0, compression_js_1.compressBody)(body, chosen, compression.level);
                cache?.set(key, body, payload);
            }
            res.setHeader('Content-Encoding', chosen);
        }
    }
    // serveStatic set no Content-Length, so every asset went out
    // chunk-framed. Setting it from the bytes actually written is required
    // once a body can be compressed (a length describing the *uncompressed*
    // body is a framing error that hangs the peer) and is a small win even
    // on the identity path.
    res.setHeader('Content-Length', String(payload.length));
    res.writeHead(status);
    res.end(payload);
}
/**
 * Wrap a `serveStatic` handler so its responses are content-negotiated.
 *
 * The returned handler keeps the wrapped one's true/false contract
 * exactly: a request `serveStatic` declines (returns false) is never
 * touched, and nothing is written to the socket for it.
 */
function withStaticCompression(handler, options) {
    const { compression } = options;
    // Nothing to negotiate: hand back the original function so the
    // production path with compression off is byte-for-byte what it was.
    if (compression === undefined || !compression.enabled)
        return handler;
    const cache = options.cache === null
        ? undefined
        : options.cache ?? new StaticCompressionCache();
    return (req, res) => {
        let status = 200;
        const headers = new Map();
        const chunks = [];
        let ended = false;
        /**
         * Set when the wrapped handler streams instead of buffering. From
         * that point the proxy is a straight pass-through: a stream must not
         * be held back waiting for a body that may never be complete.
         */
        let passthrough = false;
        const flushHead = () => {
            for (const [name, value] of headers) {
                res.setHeader(name, value);
            }
            res.writeHead(status);
        };
        const proxy = new Proxy(res, {
            get(target, prop, receiver) {
                if (!passthrough) {
                    if (prop === 'writeHead') {
                        return (code, second, third) => {
                            status = code;
                            // writeHead(status, headers) and writeHead(status, reason, headers).
                            collectHeaders(headers, typeof second === 'string' ? third : (second ?? third));
                            return receiver;
                        };
                    }
                    if (prop === 'end') {
                        return (chunk, ...rest) => {
                            if (Buffer.isBuffer(chunk))
                                chunks.push(chunk);
                            else if (typeof chunk === 'string')
                                chunks.push(Buffer.from(chunk, 'utf8'));
                            ended = true;
                            // A trailing callback argument is honoured by res.end()
                            // below; find it wherever it landed.
                            const cb = [chunk, ...rest].find(a => typeof a === 'function');
                            sendStaticBuffer(req, res, status, Buffer.concat(chunks), headers, compression, cache);
                            if (typeof cb === 'function')
                                cb();
                            return receiver;
                        };
                    }
                    if (prop === 'write') {
                        // Upstream started streaming. Give up on buffering: emit what
                        // we recorded and let everything after this go straight out.
                        return (...args) => {
                            passthrough = true;
                            if (!res.headersSent)
                                flushHead();
                            const write = res.write;
                            for (const buffered of chunks)
                                write.call(res, buffered);
                            chunks.length = 0;
                            return write.apply(res, args);
                        };
                    }
                }
                const value = Reflect.get(target, prop, target);
                return typeof value === 'function' ? value.bind(target) : value;
            },
            set(target, prop, value) {
                return Reflect.set(target, prop, value, target);
            },
        });
        const handled = handler(req, proxy);
        // `serveStatic` answers synchronously, so `handled === true` always
        // arrives with `ended === true`. If a future version ever answers
        // asynchronously, the recorded head is still flushed by the `end`
        // interception whenever it fires — this only guards the inverse
        // (claimed to handle, wrote nothing), which would otherwise hang.
        if (handled && !ended && !res.headersSent && !passthrough) {
            flushHead();
            res.end();
        }
        return handled;
    };
}
//# sourceMappingURL=static-compression.js.map