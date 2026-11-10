"use strict";
// src/server/admin-session.ts
//
// Same-origin admin sign-in for the browser UI.
//
// With `EVENT_CATALOG_AUTH_TOKEN` set, every `/api` call needs the bearer,
// reads included, and a browser page cannot hold that secret safely
// (storage is readable by any script on the origin; EventSource cannot set
// headers at all). So the operator pastes the token ONCE into a prompt,
// the server checks it and hands back an opaque session cookie, and the
// UI talks to `/admin-api/*`. This module rewrites such a request to
// `/api/*` and attaches the configured bearer server-side, ONLY when the
// request carries a live session cookie. The token never reaches page
// script after the prompt.
//
//   POST /admin/login   { token }  -> 204 + Set-Cookie, or 401 with no cookie
//   POST /admin/logout             -> 204, session dropped, cookie cleared
//   /admin-api/<path>              -> /api/<path> (bearer added if signed in)
//
// The cookie is `<random id>.<hmac(id)>`: HttpOnly, SameSite=Strict (which
// also keeps cross-site pages from riding the session), Path=/, 12 hours,
// and Secure when the request arrived over TLS. The id is meaningless
// without the in-memory session table, so a restart signs everyone out.
// The proxied request still goes through the normal auth gate; the
// proxy adds a credential, it does not skip the check.
Object.defineProperty(exports, "__esModule", { value: true });
exports.ADMIN_PROXY_PREFIX = exports.ADMIN_SESSION_TTL_MS = exports.ADMIN_COOKIE_NAME = void 0;
exports.createAdminSessions = createAdminSessions;
const node_crypto_1 = require("node:crypto");
const auth_js_1 = require("./auth.js");
exports.ADMIN_COOKIE_NAME = 'ec_admin_session';
exports.ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
exports.ADMIN_PROXY_PREFIX = '/admin-api';
const MAX_SESSIONS = 1000;
function readCookie(header, name) {
    if (!header)
        return undefined;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        if (part.slice(0, eq).trim() === name)
            return part.slice(eq + 1).trim();
    }
    return undefined;
}
function header(req, name) {
    const v = req.headers[name];
    return Array.isArray(v) ? v[0] : v;
}
function isSecure(req) {
    if (req.socket.encrypted)
        return true;
    return header(req, 'x-forwarded-proto')?.split(',')[0]?.trim() === 'https';
}
function createAdminSessions(options) {
    const { token } = options;
    const ttlMs = options.ttlMs ?? exports.ADMIN_SESSION_TTL_MS;
    const now = options.now ?? Date.now;
    const key = (0, node_crypto_1.randomBytes)(32);
    const sessions = new Map(); // id -> expiry (epoch ms)
    const sign = (id) => (0, node_crypto_1.createHmac)('sha256', key).update(id).digest('hex');
    const sessionIdFrom = (cookieHeader) => {
        const value = readCookie(cookieHeader, exports.ADMIN_COOKIE_NAME);
        if (!value)
            return undefined;
        const dot = value.indexOf('.');
        if (dot <= 0)
            return undefined;
        const id = value.slice(0, dot);
        return (0, auth_js_1.secretsMatch)(value.slice(dot + 1), sign(id)) ? id : undefined;
    };
    const isSignedIn = (cookieHeader) => {
        const id = sessionIdFrom(cookieHeader);
        if (id === undefined)
            return false;
        const expiry = sessions.get(id);
        if (expiry === undefined)
            return false;
        if (expiry <= now()) {
            sessions.delete(id);
            return false;
        }
        return true;
    };
    const prune = () => {
        const t = now();
        for (const [id, expiry] of sessions)
            if (expiry <= t)
                sessions.delete(id);
        // Map iterates in insertion order, so the oldest go first.
        while (sessions.size >= MAX_SESSIONS) {
            const oldest = sessions.keys().next().value;
            if (oldest === undefined)
                break;
            sessions.delete(oldest);
        }
    };
    const cookieAttrs = (req, maxAgeSeconds) => `; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${isSecure(req) ? '; Secure' : ''}`;
    return {
        isSignedIn,
        handleAuthRoute(req, res, body) {
            const method = (req.method ?? 'GET').toUpperCase();
            const path = (req.url ?? '/').split('?')[0];
            if (method !== 'POST' || (path !== '/admin/login' && path !== '/admin/logout'))
                return false;
            res.setHeader('Cache-Control', 'no-store');
            if (path === '/admin/logout') {
                const id = sessionIdFrom(header(req, 'cookie'));
                if (id !== undefined)
                    sessions.delete(id);
                res.statusCode = 204;
                res.setHeader('Set-Cookie', `${exports.ADMIN_COOKIE_NAME}=${cookieAttrs(req, 0)}`);
                res.end();
                return true;
            }
            const presented = body?.token;
            if (typeof presented !== 'string' || presented === '' || !(0, auth_js_1.secretsMatch)(presented, token)) {
                res.statusCode = 401;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return true;
            }
            prune();
            const id = (0, node_crypto_1.randomBytes)(32).toString('hex');
            sessions.set(id, now() + ttlMs);
            res.statusCode = 204;
            res.setHeader('Set-Cookie', `${exports.ADMIN_COOKIE_NAME}=${id}.${sign(id)}${cookieAttrs(req, Math.floor(ttlMs / 1000))}`);
            res.end();
            return true;
        },
        prepareProxy(req) {
            const url = req.url ?? '/';
            const rest = url.slice(exports.ADMIN_PROXY_PREFIX.length);
            if (!url.startsWith(exports.ADMIN_PROXY_PREFIX) || !(rest === '' || rest[0] === '/' || rest[0] === '?')) {
                return false;
            }
            req.url = `/api${rest}`;
            // Whatever the browser sent is not a credential we vouch for: drop it,
            // then add the real one only for a live session.
            delete req.headers.authorization;
            if (isSignedIn(header(req, 'cookie'))) {
                req.headers.authorization = `Bearer ${token}`;
            }
            return true;
        },
    };
}
//# sourceMappingURL=admin-session.js.map