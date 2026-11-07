import type { Middleware } from './http-router.js';
import { type CatalogLogger } from '../utils/logger.js';
/**
 * Health probes stay open (GET/HEAD only) so a liveness check cannot fail
 * because a token was rotated. `/health` and `/metrics` are served off the
 * root router, outside the `/api` prefix this middleware is mounted on;
 * they are listed so a moved mount point cannot lock out a probe or a
 * Prometheus scraper. `/api/health` is the health route under the prefix.
 * Nothing else under `/api` is open, `/api/health/registry` and
 * `/api/metrics` included — they describe the registry's internals.
 */
export declare const OPEN_HEALTH_PATHS: readonly string[];
/**
 * Shortest token accepted at boot. 16 characters is not a cryptographic
 * threshold, it is a "this is obviously a placeholder" threshold — the
 * point is to refuse `token`, `changeme` and `dev` rather than to start
 * with something that looks configured and is guessable.
 */
export declare const MIN_AUTH_TOKEN_LENGTH = 16;
/** Name of the variable that turns this on. Unset means off. */
export declare const AUTH_TOKEN_ENV_VAR = "EVENT_CATALOG_AUTH_TOKEN";
/**
 * The message-queue service-auth secret. When it is set the catalog signs
 * its publishes (including dead-letter replays) as itself, so the admin
 * API must not be open: `startServer` refuses to boot without a token.
 */
export declare const QUEUE_SECRET_ENV_VAR = "MQ_SERVICE_AUTH_SECRET";
export type AuthTokenResult = {
    readonly ok: true;
    readonly token: string | undefined;
} | {
    readonly ok: false;
    readonly error: string;
};
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
export declare function resolveAuthToken(raw: string | undefined): AuthTokenResult;
/**
 * Constant-time string equality. Both sides become a 32-byte sha256
 * digest first, so `timingSafeEqual` always gets equal-length buffers and
 * a length mismatch is a normal `false` rather than a throw — and a
 * timing observer learns nothing about the secret's length.
 */
export declare function secretsMatch(presented: string, expected: string): boolean;
/**
 * Pull the token out of `Authorization: Bearer <token>`. Returns
 * undefined for an absent, non-Bearer or empty-token header. The caller
 * must not distinguish those cases in its response.
 */
export declare function extractBearerToken(header: string | undefined): string | undefined;
/**
 * The single definition of "this request needs a credential". Reviewing
 * the protected surface means reading this function; no route file
 * decides for itself.
 */
export declare function requiresAuth(method: string, path: string): boolean;
export interface BearerAuthOptions {
    /** The shared secret. Already validated by {@link resolveAuthToken}. */
    readonly token: string;
    /**
     * Where rejection lines go. Defaults to `console.warn`. Injected so
     * tests can assert what is logged — in particular, that the presented
     * token never appears in it.
     */
    readonly onReject?: (line: string) => void;
    /**
     * Sink for the default rejection line, used when `onReject` is not
     * supplied. Defaults to `console.warn` — identical output to before.
     */
    readonly logger?: CatalogLogger;
}
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
export declare function createBearerAuthMiddleware(options: BearerAuthOptions): Middleware;
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
export declare function resolveAuthMiddleware(explicit: Middleware | undefined, token: string | undefined, logger?: CatalogLogger): Middleware | undefined;
//# sourceMappingURL=auth.d.ts.map