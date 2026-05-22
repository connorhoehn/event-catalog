import { Router } from 'express';
import type { Registry } from '../registry/index.js';
import type { MetricsCollector } from './metrics.js';
import type { MetricsObserver } from './metrics-observer.js';
import type { SignalTransport } from '../client/signal.js';
import { DurableTransport } from '../client/durable.js';
import type { DLQStore } from './dlq-store.js';
import type { PromMetrics } from './prom-metrics.js';
import type { ProducerAttributionStore } from './producer-attribution.js';
import type { PoisonEventDetector } from './poison-detector.js';
import type { RegistryCoordinator } from './registry-coordinator.js';
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
        recent(limit?: number): Promise<import('./audit-emitter.js').AuditEvent[]>;
    };
    /**
     * wave23-b — optional manifest store backing the /api/manifests
     * surface. Consumers POST {events, fingerprints} they depend on;
     * the catalog returns a per-consumer drift report on demand.
     */
    manifestStore?: import('./manifest-store.js').ManifestStore;
    /** wave26-c — tracks actual observed publishers per event. */
    attribution?: ProducerAttributionStore;
    /** wave26-e — rolling-window poison-event detector. */
    poisonDetector?: PoisonEventDetector;
    /** wave26-d — multi-replica registry coordination via Redis pub/sub. */
    coordinator?: RegistryCoordinator;
}
export declare function createRoutes(deps: RoutesDeps): Router;
//# sourceMappingURL=routes.d.ts.map