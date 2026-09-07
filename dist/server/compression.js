"use strict";
// src/server/compression.ts
//
// HTTP response compression for the admin server, on `node:zlib` alone.
//
// Why this exists: the server set no `Content-Encoding` on anything, and
// the responses an operator or a sync-at-boot consumer actually pulls are
// large and extremely repetitive JSON — `GET /api/events` is ~326 KiB of
// declarations that gzips to ~44 KiB (86.5%), the bulk export archive
// ~270 KiB → ~42 KiB (84.3%), and `GET /api/metrics/history` ~199 KiB →
// ~3 KiB (98.5%) at today's registry size, growing linearly from there.
// Sending those uncompressed is the single biggest byte-for-byte waste on
// the wire this service has.
//
// It is NOT "one config flag": distributed-core's
// `AdmissionHttpServerConfig` accepts only `port`, `hostname`,
// `backpressure`, `bodyLimits`, `onRequest`, `onError`, `errorMapper` and
// `metrics`. There is no compression option anywhere in the transport, so
// the work has to happen in this repo's own response path
// (`makeRouteResponse` in http-router.ts), which is where every one of the
// ~45 route handlers lands.
//
// Three rules the implementation is built around:
//
//   1. NEVER produce a body the client did not ask for. Content coding is
//      negotiated, not assumed. A request with no `Accept-Encoding`, or
//      with `identity;q=1, gzip;q=0`, gets identity. Getting this wrong
//      yields a response no client can read, which is strictly worse than
//      a large one.
//
//   2. NEVER touch a stream. `/api/flow` and `/api/audit` are long-lived
//      `text/event-stream` responses whose entire value is that a frame
//      reaches the browser the instant it is written. Compression here is
//      whole-buffer and applies only to the one-shot `json()` / `send()`
//      / `end(body)` paths; `flushHeaders()` and `write()` — the only two
//      calls SSE makes — latch a `streaming` flag that disables it for the
//      rest of the response's life. See `tests/compression-sse.test.ts`.
//
//   3. NEVER compress where it does not pay. Measured: a 15-byte JSON
//      body gzips to 35 bytes and an 86-byte one to 94 — a gzip member's
//      header and trailer alone are 18 bytes, so small responses come out
//      LARGER. Even where it technically wins, the win is worthless: the
//      145-byte `/health` body gzips to 109, i.e. 36 bytes saved in
//      exchange for CPU, a `Content-Encoding` header, and a `Vary` that
//      splits every shared cache entry in two. Hence the ~1 KiB floor.
//
// Measured on the real 216-declaration registry, 3 subscribers per event
// (node v25, M-series; mean of 50 sync compressions):
//
//   payload                raw    gzip L6  ratio    cost     br q5    cost
//   GET /api/events      325.6K    43.9K   86.5%  3.15 ms    39.4K  2.10 ms
//   bulk export          270.1K    42.3K   84.3%  2.81 ms    38.2K  1.95 ms
//   GET /metrics/history 199.0K     3.1K   98.5%  0.57 ms     1.9K  0.32 ms
//   GET /health (145 B)  145  B    109  B  24.8%  0.01 ms    89  B  0.01 ms  (below threshold — never compressed)
//
// Reproduce with `npx tsx scripts/bench-server.ts`, which prints this
// table from the same route handlers that serve production traffic.
//
// Brotli at quality 5 beat gzip L6 on BOTH axes for every real payload —
// smaller output and ~3x less CPU — which is why `br` is supported rather
// than dismissed. It is preferred when the client offers it; gzip is the
// fallback and the only coding a non-browser client will normally ask for.
// `deflate` costs nothing to support (same codec, no gzip wrapper) and is
// accepted for the rare client that asks for it and nothing else.
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_COMPRESSION = exports.DEFAULT_ENCODINGS = exports.BROTLI_QUALITY = exports.DEFAULT_COMPRESSION_LEVEL = exports.DEFAULT_COMPRESSION_THRESHOLD = void 0;
exports.parseAcceptEncoding = parseAcceptEncoding;
exports.negotiateEncoding = negotiateEncoding;
exports.isCompressibleType = isCompressibleType;
exports.compressBody = compressBody;
exports.chooseCompression = chooseCompression;
exports.parseBooleanFlag = parseBooleanFlag;
const node_zlib_1 = require("node:zlib");
/**
 * Below this many bytes, compressing costs more than it saves — and for
 * a few hundred bytes of JSON it makes the response *larger* (a gzip
 * member carries an 18-byte header/trailer plus the deflate block
 * overhead). 1 KiB is the conventional floor and is comfortably above
 * the break-even point measured on this API's small envelopes.
 */
exports.DEFAULT_COMPRESSION_THRESHOLD = 1024;
/**
 * zlib level for gzip/deflate. 6 is zlib's own default and the ratio is
 * consistent. Level 1 is ~3x cheaper (0.99 ms vs 3.15 ms on
 * `GET /api/events`) for ~3.6 points less ratio — 57 KiB instead of
 * 44 KiB — so an operator who cares more about event-loop time than
 * about 13 KiB on the wire sets level 1. The intermediate levels are not
 * a smooth trade: zlib switches deflate strategy around level 4, and on
 * highly repetitive payloads level 4 measured WORSE than level 6 on both
 * size and time, so 1 and 6 are the two settings worth having.
 */
exports.DEFAULT_COMPRESSION_LEVEL = 6;
/**
 * Brotli quality. 5 measured both smaller AND faster than gzip level 6
 * on every real payload here. Quality 11 (brotli's default) is an
 * order of magnitude slower and is never appropriate for a
 * dynamically-generated response.
 */
exports.BROTLI_QUALITY = 5;
/** Preference order when the client is indifferent between codings. */
exports.DEFAULT_ENCODINGS = ['br', 'gzip', 'deflate'];
exports.DEFAULT_COMPRESSION = {
    enabled: true,
    threshold: exports.DEFAULT_COMPRESSION_THRESHOLD,
    level: exports.DEFAULT_COMPRESSION_LEVEL,
    encodings: exports.DEFAULT_ENCODINGS,
};
/**
 * Parse an `Accept-Encoding` field value into `{ token, q }` pairs.
 *
 * Tolerant on purpose: a malformed qvalue (`gzip;q=banana`) is treated as
 * "no usable preference expressed for this token" — q=0 — rather than
 * throwing or defaulting to 1, because guessing "yes, compress" from
 * unparseable input is the failure mode that produces an unreadable
 * response.
 */
function parseAcceptEncoding(header) {
    const out = [];
    for (const rawPart of header.split(',')) {
        const part = rawPart.trim();
        if (part === '')
            continue;
        const [rawToken, ...params] = part.split(';');
        const token = rawToken.trim().toLowerCase();
        if (token === '')
            continue;
        let q = 1;
        for (const param of params) {
            const eq = param.indexOf('=');
            if (eq === -1)
                continue;
            if (param.slice(0, eq).trim().toLowerCase() !== 'q')
                continue;
            const raw = param.slice(eq + 1).trim();
            // RFC 9110 qvalue: 0-1 with up to 3 decimals. Anything else is junk.
            q = /^(?:0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/.test(raw) ? Number(raw) : 0;
        }
        out.push({ token, q });
    }
    return out;
}
/** `x-gzip` / `x-compress` are the historical aliases still seen in the wild. */
function canonicalToken(token) {
    if (token === 'x-gzip')
        return 'gzip';
    if (token === 'x-deflate')
        return 'deflate';
    return token;
}
/**
 * Pick the content coding to use for one response.
 *
 * The rules, straight out of RFC 9110 §12.5.3, because every one of them
 * is a way to hand a client bytes it cannot decode:
 *
 *   * A **missing** header means the client expressed no preference. The
 *     RFC permits any coding then, but plenty of hand-rolled HTTP clients
 *     (including Node's own `http.request`, which sends no
 *     `Accept-Encoding` and does no decoding) rely on getting exactly what
 *     the server generated. Missing ⇒ `identity`, always.
 *   * An **empty** header (`Accept-Encoding:` with no value) means "only
 *     identity is acceptable". Same answer.
 *   * `*` supplies a qvalue for every coding not named explicitly — but an
 *     explicit token always beats the wildcard, so `*;q=1, gzip;q=0`
 *     forbids gzip.
 *   * `identity` is acceptable by default even when unmentioned (it is
 *     only ruled out by `identity;q=0` or a `*;q=0` with no explicit
 *     identity), which is what lets us always fall back safely.
 *   * `q=0` means "not acceptable" — never a preference ordering.
 *   * The highest qvalue wins. So `identity;q=1, gzip;q=0.5` gets an
 *     uncompressed body: the client said it would rather have one.
 *     Ties go to `available` order (br, then gzip, then deflate).
 *
 * If literally everything including identity is refused, the strictly
 * correct answer is 406. We return `identity` instead: a client that
 * refuses identity and offers no coding we speak has misconfigured
 * itself, and an unreadable 406 helps nobody.
 */
function negotiateEncoding(header, available = exports.DEFAULT_ENCODINGS) {
    if (header === undefined)
        return 'identity';
    const trimmed = header.trim();
    if (trimmed === '')
        return 'identity';
    const parsed = parseAcceptEncoding(trimmed);
    const explicit = new Map();
    let wildcard;
    for (const { token, q } of parsed) {
        if (token === '*') {
            // First wildcard wins; a repeated one is malformed input.
            if (wildcard === undefined)
                wildcard = q;
            continue;
        }
        const canonical = canonicalToken(token);
        if (!explicit.has(canonical))
            explicit.set(canonical, q);
    }
    const qualityOf = (coding) => {
        const named = explicit.get(coding);
        if (named !== undefined)
            return named;
        if (wildcard !== undefined)
            return wildcard;
        // Unmentioned and no wildcard: identity stays acceptable, everything
        // else is not offered and therefore must not be sent.
        return coding === 'identity' ? 1 : 0;
    };
    // Candidates in tie-break order: the codings we can produce, then
    // identity last. A tie therefore resolves towards compressing, which is
    // what `Accept-Encoding: gzip, deflate` (three implicit q=1s, identity
    // included) has to mean. A client that would rather have identity says
    // so by giving it a HIGHER q, and then it wins on quality, not on order.
    const ranked = [...available.filter(c => c !== 'identity'), 'identity'];
    let best = 'identity';
    let bestQ = -1;
    for (const coding of ranked) {
        const q = qualityOf(coding);
        if (q > 0 && q > bestQ) {
            best = coding;
            bestQ = q;
        }
    }
    // Everything, identity included, was refused (`identity;q=0` with no
    // coding we speak). Strictly a 406; we send identity instead.
    return bestQ > 0 ? best : 'identity';
}
// ─── Content-type policy ─────────────────────────────────────────────────────
/**
 * Media types that are already compressed (or are a live stream). Running
 * deflate over a PNG or a zip burns CPU to make the body marginally
 * bigger; running it over `text/event-stream` destroys the streaming
 * property `/api/flow` exists for.
 */
const NEVER_COMPRESS_PREFIXES = [
    'image/',
    'video/',
    'audio/',
    'font/',
];
const NEVER_COMPRESS_EXACT = new Set([
    'text/event-stream',
    'application/zip',
    'application/gzip',
    'application/x-gzip',
    'application/x-bzip2',
    'application/x-7z-compressed',
    'application/x-rar-compressed',
    'application/octet-stream',
    'application/pdf',
    'application/wasm',
]);
/**
 * True when a body of this media type is worth compressing. SVG and the
 * `+json` / `+xml` structured suffixes are text underneath and compress
 * like text, so they are allowed through the `image/` and
 * `application/` blanket rules.
 */
function isCompressibleType(contentType) {
    if (contentType === undefined || contentType.trim() === '')
        return false;
    const mime = contentType.split(';')[0].trim().toLowerCase();
    if (mime === '')
        return false;
    if (mime === 'image/svg+xml')
        return true;
    if (NEVER_COMPRESS_EXACT.has(mime))
        return false;
    for (const prefix of NEVER_COMPRESS_PREFIXES) {
        if (mime.startsWith(prefix))
            return false;
    }
    if (mime.startsWith('text/'))
        return true;
    if (mime === 'application/json' || mime === 'application/javascript')
        return true;
    if (mime === 'application/xml' || mime === 'application/xhtml+xml')
        return true;
    if (mime.endsWith('+json') || mime.endsWith('+xml'))
        return true;
    return false;
}
// ─── Encoding ────────────────────────────────────────────────────────────────
/**
 * Compress `body` with `encoding`. Synchronous on purpose: `res.json()`
 * returns void and its callers do not await it, so an async compressor
 * would let `onRequest` resolve — and AdmissionHttpServer release the
 * admission slot — before the response existed. The CPU cost is bounded
 * and measured (see the table at the top of this file); it is real, and
 * it is why the threshold exists.
 */
function compressBody(body, encoding, level) {
    switch (encoding) {
        case 'br':
            return (0, node_zlib_1.brotliCompressSync)(body, {
                params: {
                    [node_zlib_1.constants.BROTLI_PARAM_QUALITY]: exports.BROTLI_QUALITY,
                    // Lets brotli size its window to the input instead of the 16 MiB
                    // default — measurably faster on payloads this size.
                    [node_zlib_1.constants.BROTLI_PARAM_SIZE_HINT]: body.length,
                },
            });
        case 'gzip':
            return (0, node_zlib_1.gzipSync)(body, { level });
        case 'deflate':
            return (0, node_zlib_1.deflateSync)(body, { level });
        case 'identity':
            return body;
    }
}
/**
 * Decide whether this particular body gets compressed, and how.
 * Returns `null` to send it verbatim.
 */
function chooseCompression(config, encoding, contentType, byteLength) {
    if (!config.enabled)
        return null;
    if (encoding === 'identity')
        return null;
    if (byteLength < config.threshold)
        return null;
    if (!isCompressibleType(contentType))
        return null;
    return encoding;
}
// ─── Env parsing (shared with src/cli/config.ts) ──────────────────────────────
const TRUE_WORDS = ['true', '1', 'yes', 'on'];
const FALSE_WORDS = ['false', '0', 'no', 'off'];
/** Accept the obvious spellings of a boolean; reject anything else loudly. */
function parseBooleanFlag(raw) {
    const lowered = raw.trim().toLowerCase();
    if (TRUE_WORDS.includes(lowered))
        return { ok: true, value: true };
    if (FALSE_WORDS.includes(lowered))
        return { ok: true, value: false };
    return { ok: false };
}
//# sourceMappingURL=compression.js.map