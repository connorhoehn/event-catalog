import { Router } from 'express';
import type { Registry } from '../registry/index.js';
import type { MetricsCollector } from './metrics.js';
import type { SignalTransport } from '../client/signal.js';
import type { DurableTransport } from '../client/durable.js';
export interface RoutesDeps {
    registry: Registry;
    metrics: MetricsCollector;
    signal: SignalTransport;
    durable: DurableTransport;
    startedAt: number;
}
export declare function createRoutes(deps: RoutesDeps): Router;
//# sourceMappingURL=routes.d.ts.map