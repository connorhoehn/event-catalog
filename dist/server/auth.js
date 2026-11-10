"use strict";
// src/server/auth.ts
//
// Shared-secret authentication for the admin API.
//
// WHEN IT IS ON
//
// Whenever `EVENT_CATALOG_AUTH_TOKEN` is set. `startServer` additionally
// refuses to boot without a token (or an injected middleware) in
// production and whenever `MQ_SERVICE_AUTH_SECRET` is configured: with the
// queue secret set, a dead-letter replay is re-published to the message
// queue signed as the catalog itself, so an open admin API would let
// anyone publish under the catalog's identity. With neither set (local
// development) no middleware is installed and the API stays open.
//
// WHAT IT GATES WHEN IT IS ON
//
// Every request under `/api`, reads included — dead-letter payloads,
// schemas, subscriber lists and the SSE streams are all data another
// service produced. The only exceptions are the health routes
// ({@link OPEN_HEALTH_PATHS}, GET/HEAD only) and CORS preflights. The
// gated set is decided in exactly one place ({@link requiresAuth}) rather
// than per route, so a route added tomorrow under src/server/routes/ is
// covered the moment it is mounted.
//
// The admin UI holds no token: the operator signs in once and the server
// attaches the bearer to `/admin-api/*` requests that carry a session cookie
// (src/server/admin-session.ts). An authenticating reverse proxy that injects
// the header itself works too.
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
exports.QUEUE_SECRET_ENV_VAR = exports.AUTH_TOKEN_ENV_VAR = exports.MIN_AUTH_TOKEN_LENGTH = exports.OPEN_HEALTH_PATHS = void 0;
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
 * Health probes stay open (GET/HEAD only) so a liveness check cannot fail
 * because a token was rotated. `/health` and `/metrics` are served off the
 * root router, outside the `/api` prefix this middleware is mounted on;
 * they are listed so a moved mount point cannot lock out a probe or a
 * Prometheus scraper. `/api/health` is the health route under the prefix.
 * Nothing else under `/api` is open, `/api/health/registry` and
 * `/api/metrics` included — they describe the registry's internals.
 */
exports.OPEN_HEALTH_PATHS = ['/health', '/metrics', '/api/health'];
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
 * The message-queue service-auth secret. When it is set the catalog signs
 * its publishes (including dead-letter replays) as itself, so the admin
 * API must not be open: `startServer` refuses to boot without a token.
 */
exports.QUEUE_SECRET_ENV_VAR = 'MQ_SERVICE_AUTH_SECRET';
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
    const verb = method.toUpperCase();
    // CORS preflight carries no credentials by spec and is answered before
    // this middleware runs anyway.
    if (verb === 'OPTIONS')
        return false;
    if ((verb === 'GET' || verb === 'HEAD') && exports.OPEN_HEALTH_PATHS.includes(normalizePath(path))) {
        return false;
    }
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
 * hammer: every unauthenticated request writes a line, so a scanner
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
 * Admits the health routes and CORS preflights untouched. Challenges
 * everything else, reads included: a correct bearer token calls `next()`,
 * anything else gets a bare 401.
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
 * Pick the middleware `startServer` installs. With no explicit middleware
 * and no configured token this returns `undefined`; `startServer` then
 * refuses to boot in production or with the queue secret set, and runs
 * open only for local development.
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