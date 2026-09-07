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
}
/** 404 envelope used by every handler that resolves an event by name. */
export declare function eventNotFound(res: Response, name: string): void;
/** 400 envelope used by the request-validation guards. */
export declare function badRequest(res: Response, message: string): void;
/**
 * Coerce a query param to a single string, dropping the repeated-key
 * array form. Mirrors the `typeof x === 'string' ? x : undefined`
 * guard the handlers were written with.
 */
export declare function stringParam(req: Request, key: string): string | undefined;
/**
 * Write the SSE preamble headers and flush them. Shared by /api/flow
 * and /api/audit; the `X-Accel-Buffering` header defeats nginx /
 * proxies that otherwise buffer SSE responses.
 */
export declare function openSseStream(res: Response): void;
/** Heartbeat every 30s to prevent intermediaries from idle-timing out. */
export declare function startSseHeartbeat(res: Response): ReturnType<typeof setInterval>;
//# sourceMappingURL=_shared.d.ts.map