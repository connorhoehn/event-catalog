"use strict";
// src/server/auth.ts
//
// Optional shared-secret authentication for the admin API.
//
// WHY THIS IS OPT-IN
//
// The catalog has always shipped with an open API: it is meant to sit on
// a private in-cluster network, and the admin UI, the `syncToRemoteRegistry`
// call every producer makes at boot, and every CI job that snapshots or
// pins a manifest all talk to it without a credential. Turning auth on by
// default would break all of them on upgrade. So this module ships the
// capability and nothing turns it on: with `EVENT_CATALOG_AUTH_TOKEN`
// unset, `resolveAuthMiddleware()` returns `undefined`, no middleware is
// installed, and the request path is byte-for-byte what it was before.
//
// WHAT IT GATES WHEN IT IS ON
//
// Mutating requests only — every method outside {@link SAFE_METHODS}.
// That is the whole reason a read-only deployment stays usable: the admin
// UI, `GET /api/events`, the `/api/flow` and `/api/audit` SSE streams,
// `/health` and `/metrics` are all GETs and are never challenged. The
// gated set is decided in exactly one place ({@link requiresAuth}) rather
// than per-route, so reviewing "what is protected" is reading one
// function, and a route added tomorrow under src/server/routes/ is
// covered the moment it accepts a POST.
//
// `/health` and `/metrics` are additionally named in
// {@link ALWAYS_OPEN_PATHS}. They are served off the root router, outside
// the `/api` prefix this middleware is mounted on, so today they cannot
// reach it at all — the list is there so that if the mount point ever
// moves, a liveness probe or a Prometheus scraper cannot be locked out by
// a change made somewhere else.
//
// COMPARISON
//
// Both sides are hashed to a fixed-width sha256 digest before
// `timingSafeEqual`, which throws on unequal buffer lengths. Comparing
// digests means the comparison is constant-time in the value AND tells an
// attacker nothing about the secret's length — feeding raw strings to
// `timingSafeEqual` would have made a length mismatch an immediate,
// distinguishable throw.
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUTH_TOKEN_ENV_VAR = exports.MIN_AUTH_TOKEN_LENGTH = exports.ALWAYS_OPEN_PATHS = exports.SAFE_METHODS = void 0;
exports.resolveAuthToken = resolveAuthToken;
exports.secretsMatch = secretsMatch;
exports.extractBearerToken = extractBearerToken;
exports.requiresAuth = requiresAuth;
exports.createBearerAuthMiddleware = createBearerAuthMiddleware;
exports.resolveAuthMiddleware = resolveAuthMiddleware;
const node_crypto_1 = require("node:crypto");
const bounded_js_1 = require("../utils/bounded.js");
const logger_js_1 = require("../utils/logger.js");
/**
 * Methods that never mutate registry state and are therefore never
 * challenged. HEAD and OPTIONS ride along with GET: OPTIONS is the CORS
 * preflight (answered before this middleware runs anyway) and HEAD is a
 * GET without a body.
 */
exports.SAFE_METHODS = ['GET', 'HEAD', 'OPTIONS'];
/**
 * Paths that stay open regardless of method. A liveness probe and a
 * metrics scraper must never be able to fail because a token was rotated.
 */
exports.ALWAYS_OPEN_PATHS = ['/health', '/metrics'];
/**
 * Shortest token accepted at boot. 16 characters is not a cryptographic
 * threshold, it is a "this is obviously a placeholder" threshold — the
 * point is to refuse `token`, `changeme` and `dev` rather than to start
 * with something that looks configured and is guessable.
 */
exports.MIN_AUTH_TOKEN_LENGTH = 16;
/** Name of the variable that turns this on. Unset means off. */
exports.AUTH_TOKEN_ENV_VAR = 'EVENT_CATALOG_AUTH_TOKEN';
/**
 * Decide what a raw `EVENT_CATALOG_AUTH_TOKEN` value means.
 *
 *   * absent            → auth is off (the default, and the only way to
 *                         get today's behavior)
 *   * present but empty → a boot error, NOT "off"
 *   * too short / has whitespace or control characters → a boot error
 *   * otherwise         → on, with the trimmed value as the secret
 *
 * The empty case deliberately breaks this module's usual "an empty env
 * var is not a value" convention. Everywhere else that convention is
 * harmless; here, `EVENT_CATALOG_AUTH_TOKEN=${CATALOG_TOKEN}` with an
 * unset `CATALOG_TOKEN` would silently boot a server the operator
 * believes is authenticated. Failing loudly is the only safe reading.
 *
 * Error strings never echo the value — a boot failure lands in container
 * logs, and the whole point of the variable is that it is a secret.
 */
function resolveAuthToken(raw) {
    if (raw === undefined)
        return { ok: true, token: undefined };
    const trimmed = raw.trim();
    if (trimmed === '') {
        return {
            ok: false,
            error: 'is set but empty — unset it entirely to leave the admin API '
                + 'unauthenticated (the default), or give it a real secret',
        };
    }
    if (/[\s\u0000-\u001f\u007f]/.test(trimmed)) {
        return {
            ok: false,
            error: 'contains whitespace or control characters (value redacted) — a '
                + 'bearer token must survive an HTTP header verbatim',
        };
    }
    if (trimmed.length < exports.MIN_AUTH_TOKEN_LENGTH) {
        return {
            ok: false,
            error: `is shorter than ${exports.MIN_AUTH_TOKEN_LENGTH} characters (value redacted) `
                + '— a short shared secret is brute-forceable in minutes. Generate '
                + 'one with `openssl rand -hex 32`',
        };
    }
    return { ok: true, token: trimmed };
}
// ─── Comparison ─────────────────────────────────────────────────────────────
function sha256(value) {
    return (0, node_crypto_1.createHash)('sha256').update(value, 'utf8').digest();
}
/**
 * Constant-time string equality. Both sides become a 32-byte sha256
 * digest first, so `timingSafeEqual` always gets equal-length buffers and
 * a length mismatch is a normal `false` rather than a throw — and a
 * timing observer learns nothing about the secret's length.
 */
function secretsMatch(presented, expected) {
    return (0, node_crypto_1.timingSafeEqual)(sha256(presented), sha256(expected));
}
// ─── Header parsing ─────────────────────────────────────────────────────────
/**
 * Pull the token out of `Authorization: Bearer <token>`. Returns
 * undefined for an absent, non-Bearer or empty-token header. The caller
 * must not distinguish those cases in its response.
 */
function extractBearerToken(header) {
    if (header === undefined)
        return undefined;
    const match = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(header.trim());
    return match ? match[1] : undefined;
}
// ─── The gate ───────────────────────────────────────────────────────────────
/** Strip a query string and a trailing slash so path matching is stable. */
function normalizePath(path) {
    const withoutQuery = path.split('?')[0];
    if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
        return withoutQuery.slice(0, -1);
    }
    return withoutQuery;
}
/**
 * The single definition of "this request needs a credential". Reviewing
 * the protected surface means reading this function; no route file
 * decides for itself.
 */
function requiresAuth(method, path) {
    if (exports.SAFE_METHODS.includes(method.toUpperCase()))
        return false;
    if (exports.ALWAYS_OPEN_PATHS.includes(normalizePath(path)))
        return false;
    return true;
}
/**
 * Keep an attacker-controlled method/path out of the log's line
 * structure. A `POST /api/events/%0A[auth]%20admitted...` would otherwise
 * forge a second log line.
 */
function sanitizeForLog(value) {
    const cleaned = value.replace(/[\u0000-\u001f\u007f]/g, '?');
    return cleaned.length > 200 ? `${cleaned.slice(0, 200)}…` : cleaned;
}
function describeSource(req) {
    return req.raw?.socket?.remoteAddress ?? 'unknown';
}
/**
 * Rate ceiling on rejection lines, keyed by source address.
 *
 * This is a per-request path on the one endpoint family an attacker can
 * hammer: every unauthenticated POST/DELETE writes a line, so a scanner
 * or a misconfigured producer retrying its boot sync is an unbounded log
 * source reachable by anyone who can open a socket. Ten lines a minute
 * per source still shows an operator that something is being rejected
 * and from where; the count of what was suppressed rides along on the
 * line itself.
 *
 * The throttle sits in front of `onReject` too, not only the default
 * sink: the storm is a property of this call site, and an injected sink
 * cannot know that.
 */
const REJECT_LOG_WINDOW_MS = 60_000;
const REJECT_LOGS_PER_WINDOW = 10;
/** Distinct source addresses tracked before oldest-first eviction. */
const REJECT_LOG_MAX_SOURCES = 256;
/**
 * Connect-style middleware for `ServerConfig.authMiddleware`.
 *
 * Admits every safe-method request untouched. Challenges everything else:
 * a correct bearer token calls `next()`, anything else gets a bare 401.
 * The response body is identical for an absent, malformed and wrong
 * token, so a caller cannot probe the header format or learn that a token
 * was "close". The server-side log line carries source, method and path —
 * enough to investigate — and never the presented value.
 */
function createBearerAuthMiddleware(options) {
    const { token } = options;
    const log = new logger_js_1.LogWriter(options.logger);
    const throttle = new bounded_js_1.LogThrottle({
        keyIntervalMs: REJECT_LOG_WINDOW_MS,
        maxPerWindow: REJECT_LOGS_PER_WINDOW,
        maxKeys: REJECT_LOG_MAX_SOURCES,
    });
    return (req, res, next) => {
        if (!requiresAuth(req.method, req.path)) {
            next();
            return;
        }
        const presented = extractBearerToken(req.header('authorization'));
        if (presented !== undefined && secretsMatch(presented, token)) {
            next();
            return;
        }
        const source = sanitizeForLog(describeSource(req));
        const suppressed = throttle.attempt(source);
        if (suppressed !== null) {
            const line = `[auth] rejected ${sanitizeForLog(req.method)} ${sanitizeForLog(req.path)} `
                + `from ${source} — missing or invalid bearer token`
                + bounded_js_1.LogThrottle.suffix(suppressed);
            if (options.onReject)
                options.onReject(line);
            else {
                log.warn(line, {
                    component: 'auth',
                    method: sanitizeForLog(req.method),
                    path: sanitizeForLog(req.path),
                    source,
                    reason: 'missing-or-invalid-bearer-token',
                    suppressed,
                });
            }
        }
        res.setHeader('WWW-Authenticate', 'Bearer');
        res.status(401).json({ error: 'Unauthorized' });
    };
}
/**
 * Pick the middleware `startServer` installs, and the reason the default
 * is provably unchanged: with no explicit middleware and no configured
 * token this returns `undefined`, and `startServer` then runs the exact
 * request path it ran before this module existed.
 *
 * An explicit `ServerConfig.authMiddleware` always wins — a library
 * consumer who brings their own JWT check is not second-guessed by an
 * environment variable.
 */
function resolveAuthMiddleware(explicit, token, logger) {
    if (explicit !== undefined)
        return explicit;
    if (token === undefined)
        return undefined;
    return createBearerAuthMiddleware({ token, logger });
}
//# sourceMappingURL=auth.js.map