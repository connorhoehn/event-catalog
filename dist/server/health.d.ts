import type { Request, Response } from 'express';
/**
 * Tri-state health handler matching the `@connorhoehn/service-runtime`
 * shape (with `id`/`status`/`details` per check), inlined here because
 * service-runtime exports `makeHealthHandler` with a slightly
 * different field naming (`name`/`ok`) and event-catalog should not
 * gain a hard dep on it just for the shape.
 *
 * Output shape:
 * {
 *   service: 'event-catalog',
 *   version: '0.1.1',
 *   status: 'healthy' | 'degraded' | 'unhealthy',
 *   checks: [
 *     { id: 'redis', status: 'healthy' | 'degraded' | 'unhealthy', details?: unknown },
 *     ...
 *   ],
 *   timestamp: '2026-05-14T...Z'
 * }
 *
 * HTTP status: 200 for healthy/degraded, 503 for unhealthy. Any
 * single unhealthy check ⇒ overall unhealthy; otherwise any degraded
 * ⇒ overall degraded; else healthy.
 */
export type HealthStatus = 'healthy' | 'degraded' | 'unhealthy';
export interface HealthCheckResult {
    status: HealthStatus;
    details?: unknown;
}
export interface HealthCheck {
    id: string;
    check: () => Promise<HealthCheckResult>;
}
export interface HealthCheckReport {
    id: string;
    status: HealthStatus;
    details?: unknown;
    durationMs: number;
}
export interface HealthBody {
    service: string;
    version: string;
    status: HealthStatus;
    checks: HealthCheckReport[];
    timestamp: string;
}
export interface MakeHealthHandlerOptions {
    service: string;
    version: string;
    checks: HealthCheck[];
    /** Per-check timeout in ms. Default 5000. */
    timeoutMs?: number;
}
export declare function makeHealthHandler(opts: MakeHealthHandlerOptions): (req: Request, res: Response) => Promise<void>;
//# sourceMappingURL=health.d.ts.map