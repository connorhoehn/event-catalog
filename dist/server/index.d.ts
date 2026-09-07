import { type DeadLetteredMessage } from '../client/durable.js';
import { type Middleware } from './http-router.js';
import type { RegistryEntry } from '../types/index.js';
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