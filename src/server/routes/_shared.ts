// src/server/routes/_shared.ts
//
// Shared types + mechanical helpers for the /api route modules.
//
// `RoutesDeps` lives here (rather than in routes.ts) so every route
// module can import it without a cycle back through the barrel. The
// helpers below are literal de-duplications of boilerplate that was
// repeated verbatim across the handlers — response envelopes, query
// coercion, SSE preamble — with no behavior change.

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
  auditLog?: { recent(limit?: number): Promise<import('../audit-emitter.js').AuditEvent[]> };
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
export function eventNotFound(res: Response, name: string): void {
  res.status(404).json({ error: `Event "${name}" not found` });
}

/** 400 envelope used by the request-validation guards. */
export function badRequest(res: Response, message: string): void {
  res.status(400).json({ error: message });
}

/**
 * Coerce a query param to a single string, dropping the repeated-key
 * array form. Mirrors the `typeof x === 'string' ? x : undefined`
 * guard the handlers were written with.
 */
export function stringParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

/**
 * Write the SSE preamble headers and flush them. Shared by /api/flow
 * and /api/audit; the `X-Accel-Buffering` header defeats nginx /
 * proxies that otherwise buffer SSE responses.
 */
export function openSseStream(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

/** Heartbeat every 30s to prevent intermediaries from idle-timing out. */
export function startSseHeartbeat(res: Response): ReturnType<typeof setInterval> {
  return setInterval(() => {
    res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
  }, 30_000);
}
