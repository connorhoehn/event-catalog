// src/server/routes/ops.ts
//
// Operational surfaces: liveness/readiness health checks and the
// in-process metrics snapshot + per-event rate history.

import type { Request, Response } from '../http-router.js';
import { stringParam, type RoutesDeps } from './_shared.js';

export function createOpsHandlers(deps: RoutesDeps) {
  const { registry, metrics, signal, durable, startedAt, manifestStore } = deps;

  // Health check
  async function health(_req: Request, res: Response): Promise<void> {
    const [redisHealth, mqHealth] = await Promise.all([
      signal.healthCheck(),
      durable.healthCheck(),
    ]);

    let status: 'healthy' | 'degraded' | 'unhealthy';
    if (redisHealth.status === 'disconnected' || mqHealth.status === 'disconnected') {
      status = 'unhealthy';
    } else if (redisHealth.status === 'degraded' || mqHealth.status === 'degraded') {
      status = 'degraded';
    } else {
      status = 'healthy';
    }

    const httpStatus = status === 'unhealthy' ? 503 : 200;
    const uptimeMs = Date.now() - startedAt;

    res.status(httpStatus).json({
      status,
      redis: redisHealth,
      messageQueue: mqHealth,
      uptime: Math.floor(uptimeMs / 1000),
      eventCount: registry.size(),
    });
  }

  // wave26-b — richer registry health snapshot for k8s readiness probes
  // and the admin Dashboard health summary card. Returns the same
  // transport health plus registry-specific counters.
  async function registryHealth(_req: Request, res: Response): Promise<void> {
    const all = registry.list();
    const nsSet = new Set(all.map(e => e.namespace));
    const deprecatedCount = all.filter(e => !!e.deprecation).length;
    const orphanCount = all.filter(e => e.subscribers.length === 0).length;
    const [signalHealth, durableHealth] = await Promise.all([
      signal.healthCheck(),
      durable.healthCheck(),
    ]);
    let manifestCount: number | null = null;
    if (manifestStore) {
      try { manifestCount = (await manifestStore.list()).length; } catch { /* best-effort */ }
    }
    res.json({
      registrySize: registry.size(),
      namespaceCount: nsSet.size,
      deprecatedCount,
      orphanCount,
      manifestCount,
      signal: signalHealth,
      durable: durableHealth,
      capturedAt: new Date().toISOString(),
    });
  }

  // All metrics snapshot
  function snapshot(_req: Request, res: Response): void {
    res.json(metrics.snapshot());
  }

  // wave26-a — per-event publish rate history for sparklines. Returns
  // the last 60 rate snapshots per event (one sample ~every 15s = ~15min
  // of coverage). Used by EventList to draw inline sparklines.
  function history(_req: Request, res: Response): void {
    res.json(metrics.getHistory(stringParam(_req, 'eventName')));
  }

  return { health, registryHealth, snapshot, history };
}
