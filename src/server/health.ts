import type { Request, Response } from './http-router.js';

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
  insecureDevMode?: true;
  timestamp: string;
}

export interface MakeHealthHandlerOptions {
  service: string;
  version: string;
  checks: HealthCheck[];
  /** Reported as `insecureDevMode: true` when the host runs in dev mode. */
  insecureDevMode?: boolean;
  /** Per-check timeout in ms. Default 5000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5000;

async function runWithTimeout(check: HealthCheck, timeoutMs: number): Promise<HealthCheckReport> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race<HealthCheckResult>([
      check.check(),
      new Promise<HealthCheckResult>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`health check '${check.id}' timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
    const report: HealthCheckReport = {
      id: check.id,
      status: result.status,
      durationMs: Date.now() - start,
    };
    if (result.details !== undefined) {
      report.details = result.details;
    }
    return report;
  } catch (err) {
    return {
      id: check.id,
      status: 'unhealthy',
      durationMs: Date.now() - start,
      details: { error: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rollup(reports: HealthCheckReport[]): HealthStatus {
  if (reports.some((r) => r.status === 'unhealthy')) return 'unhealthy';
  if (reports.some((r) => r.status === 'degraded')) return 'degraded';
  return 'healthy';
}

export function makeHealthHandler(
  opts: MakeHealthHandlerOptions,
): (req: Request, res: Response) => Promise<void> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return async function healthHandler(_req: Request, res: Response): Promise<void> {
    const reports = await Promise.all(opts.checks.map((c) => runWithTimeout(c, timeoutMs)));
    const status = rollup(reports);
    const httpCode = status === 'unhealthy' ? 503 : 200;
    const body: HealthBody = {
      service: opts.service,
      version: opts.version,
      status,
      checks: reports,
      timestamp: new Date().toISOString(),
    };
    if (opts.insecureDevMode) body.insecureDevMode = true;
    res.status(httpCode).json(body);
  };
}
