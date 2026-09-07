import type { Request, Response } from '../http-router.js';
import type { Registry } from '../../registry/index.js';
import type { MetricsCollector } from '../metrics.js';
import type { MetricsObserver } from '../metrics-observer.js';
import type { SignalTransport } from '../../client/signal.js';
import type { DurableTransport } from '../../client/durable.js';
import type { DLQStore } from '../dlq-store.js';
import type { PromMetrics } from '../prom-metrics.js';
import type { ProducerAttributionStore } from '../producer-attribution.js';
import type { PoisonEventDetector } from '../poison-detector.js';
import type { RegistryCoordinator } from '../registry-coordinator.js';
import { type LogThrottleOptions } from '../../utils/bounded.js';
import { type CatalogLogger, type LogFields } from '../../utils/logger.js';
export interface RoutesDeps {
    registry: Registry;
    metrics: MetricsCollector;
    metricsObserver: MetricsObserver;
    signal: SignalTransport;
    durable: DurableTransport;
    dlqStore: DLQStore;
    startedAt: number;
    /** Optional prom-format metric surface; injected by startServer. */
    promMetrics?: PromMetrics;
    /**
     * wave23-a — optional handle to the persistent audit log. When
     * supplied, GET /api/audit/recent serves history from it and
     * GET /api/audit replays the last N events to a new SSE client
     * before streaming live.
     */
    auditLog?: {
        recent(limit?: number): Promise<import('../audit-emitter.js').AuditEvent[]>;
    };
    /**
     * wave23-b — optional manifest store backing the /api/manifests
     * surface. Consumers POST {events, fingerprints} they depend on;
     * the catalog returns a per-consumer drift report on demand.
     */
    manifestStore?: import('../manifest-store.js').ManifestStore;
    /** wave26-c — tracks actual observed publishers per event. */
    attribution?: ProducerAttributionStore;
    /** wave26-e — rolling-window poison-event detector. */
    poisonDetector?: PoisonEventDetector;
    /** wave26-d — multi-replica registry coordination via Redis pub/sub. */
    coordinator?: RegistryCoordinator;
    /**
     * Diagnostics sink for the handlers, threaded from `ServerConfig`.
     * Omitted, every route line goes to `console.warn` exactly as before.
     */
    logger?: CatalogLogger;
}
/**
 * Default rate ceiling for handler diagnostics.
 *
 * Every warning a route handler emits is by definition on a per-request
 * path, and the admin API is unauthenticated by default — so each of
 * them is a log source an arbitrary caller can drive at line rate. A
 * single client looping `GET /api/events/x/history` against a down Redis
 * writes one line per request, forever.
 *
 * Ten a minute per key is enough to see what is failing and how often
 * (the suppressed count rides on the line); the metrics and the 503s are
 * the volume-independent signal.
 */
export declare const ROUTE_LOG_WINDOW_MS = 60000;
export declare const ROUTE_LOGS_PER_WINDOW = 10;
/**
 * Throttled, structured diagnostics for a route module.
 *
 * One instance per handler factory, so the key space is scoped to a
 * route family and a noisy `/history` cannot suppress a `/dlq` line.
 * Keys must be derived from something bounded — a route name plus at
 * most an event name — because they are the throttle's dedupe key and
 * event names arrive from HTTP; `maxKeys` bounds the damage regardless.
 */
export declare class RouteLog {
    private readonly log;
    private readonly throttle;
    constructor(logger?: CatalogLogger, options?: LogThrottleOptions);
    /**
     * Emit one line unless the throttle says otherwise.
     *
     * `tail` is what the call site used to pass as extra `console.warn`
     * arguments; it is forwarded verbatim on the default console sink and
     * is always also present in `fields`, so an injected sink loses
     * nothing. The suppressed-count suffix goes *before* a trailing colon
     * so `… failed (+3 similar suppressed): detail` still reads correctly,
     * and is the empty string — hence byte-identical output — when nothing
     * was suppressed.
     */
    warn(key: string, message: string, fields: LogFields, ...tail: unknown[]): void;
}
/** 404 envelope used by every handler that resolves an event by name. */
export declare function eventNotFound(res: Response, name: string): void;
/** 400 envelope used by the request-validation guards. */
export declare function badRequest(res: Response, message: string): void;
/**
 * Coerce a query param to a single string, dropping the repeated-key
 * array form. Mirrors the `typeof x === 'string' ? x : undefined`
 * guard the handlers were written with.
 *
 * Use this only where silently ignoring a malformed param is the
 * documented contract (the SSE filters). Everywhere else prefer
 * {@link singleParam}, which reports the array form instead of
 * quietly widening the result set.
 */
export declare function stringParam(req: Request, key: string): string | undefined;
/** True for a plain JSON object (not null, not an array). */
export declare function isJsonObject(value: unknown): value is Record<string, unknown>;
/** The parsed JSON body when it is an object, else undefined. */
export declare function jsonBody(req: Request): Record<string, unknown> | undefined;
/** Discriminated result returned by the query-param guards. */
export type ParamResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    error: string;
};
/**
 * Read a query param as a single string. Repeated keys are rejected;
 * a present-but-empty value is treated as absent (a bare `?tag=` should
 * not filter on the empty string).
 */
export declare function singleParam(req: Request, key: string): ParamResult<string | undefined>;
/**
 * Read a query param constrained to a fixed set of values, narrowing the
 * result to the union type rather than casting. Rejects both the repeated
 * key form and out-of-set values.
 */
export declare function enumParam<T extends string>(req: Request, key: string, allowed: readonly T[]): ParamResult<T | undefined>;
/**
 * Resolve a set of guards, writing a 400 and returning null on the first
 * failure. Lets a handler collapse five guards into one early return:
 *
 *   const q = resolveParams(res, { transport: enumParam(...), tag: singleParam(...) });
 *   if (!q) return;
 */
export declare function resolveParams<T extends Record<string, ParamResult<unknown>>>(res: Response, guards: T): {
    [K in keyof T]: T[K] extends ParamResult<infer V> ? V : never;
} | null;
/**
 * Write the SSE preamble headers and flush them. Shared by /api/flow
 * and /api/audit; the `X-Accel-Buffering` header defeats nginx /
 * proxies that otherwise buffer SSE responses.
 */
export declare function openSseStream(res: Response): void;
/** Heartbeat every 30s to prevent intermediaries from idle-timing out. */
export declare function startSseHeartbeat(res: Response): ReturnType<typeof setInterval>;
//# sourceMappingURL=_shared.d.ts.map