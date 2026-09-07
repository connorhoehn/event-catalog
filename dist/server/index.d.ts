import { type BodyLimitsConfig } from 'distributed-core/server';
import { type DeadLetteredMessage } from '../client/durable.js';
import { type Middleware } from './http-router.js';
import type { RegistryEntry } from '../types/index.js';
/**
 * Hard cap on a request body, in bytes. Matches the `express.json({ limit:
 * '1mb' })` the server ran with before the AdmissionHttpServer move. Nothing
 * this API accepts is close to 1 MiB — the largest legitimate body is a bulk
 * declare — so the cap is purely an OOM guard.
 *
 * Exported so the test suite can drive a body of exactly this size + 1 and
 * assert the rejection, rather than trusting the config key spelling. It was
 * previously passed as `maxBodyBytes`, which is not a key of
 * `BodyLimitsConfig`; it was silently dropped and the server ran on
 * distributed-core's 16 MiB `DEFAULT_MAX_BODY_BYTES` instead.
 */
export declare const MAX_REQUEST_BODY_BYTES = 1048576;
/**
 * Slow-loris cutoff for reading a request body. Pinned explicitly at the
 * value distributed-core currently defaults to, so an upstream change to
 * `DEFAULT_READ_TIMEOUT_MS` can't quietly move this server's threshold the
 * way the dropped body cap did.
 */
export declare const BODY_READ_TIMEOUT_MS = 30000;
/**
 * The exact `bodyLimits` object handed to AdmissionHttpServer. Annotated as
 * `BodyLimitsConfig` so a misspelled key is a compile error rather than a
 * silently ignored property, and exported so `tests/server-body-limits.test.ts`
 * can bind a server with THIS object and prove the cap is enforced.
 */
export declare const REQUEST_BODY_LIMITS: BodyLimitsConfig;
/**
 * Phase 20-d — DLQ handler context. Built once per dead-letter event by
 * looking the envelope's eventName up in the local Registry, so operator
 * handlers get the canonical RegistryEntry + namespace without a second
 * lookup. Both fields are optional because dead-letters can fire on
 * undeclared events (consumer drift).
 */
export interface DeadLetterContext {
    entry?: RegistryEntry;
    namespace?: string;
}
/** Phase 20-d — server-side DLQ handler. */
export type DeadLetterHandler = (message: DeadLetteredMessage, context: DeadLetterContext) => void | Promise<void>;
/**
 * Phase 20-d — internal factory that builds the dead-letter callback
 * the server registers on the DurableTransport. Exported so tests can
 * exercise the wiring in isolation (no Redis / DDB roundtrip).
 *
 *   1. Write to the DLQ store (honoring declared dlqRetention).
 *   2. Fan out to operator-supplied handlers with enriched context.
 *      Errors caught + logged so a webhook hiccup can't fail the
 *      primary DLQ write.
 */
export declare function buildDeadLetterCallback(deps: {
    registry: {
        get(name: string): RegistryEntry | undefined;
    };
    dlqStore: {
        put(entry: {
            eventName: string;
            payload: unknown;
            error: string;
            attempts: number;
            deadAt: string;
        }, retentionSeconds?: number): Promise<unknown>;
    };
    additionalHandlers: DeadLetterHandler[];
}): (message: DeadLetteredMessage) => void;
export interface ServerConfig {
    port?: number;
    redisUrl?: string;
    messageQueueUrl?: string;
    corsOrigin?: string | boolean;
    /**
     * Phase 20-d — additional DLQ handlers run alongside the built-in
     * "write to DDB" handler. Each receives the failing message plus a
     * context with the canonical registry entry and namespace. Errors
     * thrown by these handlers are caught + logged so a webhook hiccup
     * can't fail the primary DLQ write.
     */
    onDeadLetter?: DeadLetterHandler[];
    /**
     * Phase 20-d — optional connect-style middleware gating every `/api`
     * route. The admin server is unauthenticated by default
     * (deliberately, for local dev); operators can inject a JWT / API-key
     * check here without forking startServer. Call `next()` to admit the
     * request; respond on `res` without calling next to reject it.
     */
    authMiddleware?: Middleware;
}
export declare function startServer(config?: ServerConfig): Promise<{
    /** Bound address (distributed-core AdmissionHttpServer.address()). */
    address: () => {
        port: number;
        hostname: string;
    } | null;
    shutdown: () => Promise<void>;
}>;
//# sourceMappingURL=index.d.ts.map