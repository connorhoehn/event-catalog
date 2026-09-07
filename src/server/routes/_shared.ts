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
 *
 * Use this only where silently ignoring a malformed param is the
 * documented contract (the SSE filters). Everywhere else prefer
 * {@link singleParam}, which reports the array form instead of
 * quietly widening the result set.
 */
export function stringParam(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === 'string' ? value : undefined;
}

// ─── Request body ────────────────────────────────────────────────────────────
//
// `req.body` is `unknown` — it is whatever JSON.parse returned. Handlers used
// to reach into it with `req.body?.x`, which TypeScript resolves against `{}`
// and rejects. These two narrow it once, at the edge, so handlers work with a
// real type instead of a cast.

/** True for a plain JSON object (not null, not an array). */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The parsed JSON body when it is an object, else undefined. */
export function jsonBody(req: Request): Record<string, unknown> | undefined {
  return isJsonObject(req.body) ? req.body : undefined;
}

// ─── Query-param guards ──────────────────────────────────────────────────────
//
// A repeated key (`?transport=signal&transport=durable`) is parsed into a
// `string[]` by `parseQuery`. Handlers that cast with `as string` therefore
// leak an ARRAY into the registry/store filters, where it either stringifies
// to `'signal,durable'` (matching nothing, so the response looks like a clean
// empty result) or breaks the query outright. The DLQ handlers already
// rejected that shape by hand; these helpers are that guard, generalized, so
// every route family fails loudly on the same input.

/** Discriminated result returned by the query-param guards. */
export type ParamResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

/**
 * Read a query param as a single string. Repeated keys are rejected;
 * a present-but-empty value is treated as absent (a bare `?tag=` should
 * not filter on the empty string).
 */
export function singleParam(req: Request, key: string): ParamResult<string | undefined> {
  const raw = req.query[key];
  if (raw === undefined) return { ok: true, value: undefined };
  if (typeof raw !== 'string') {
    return { ok: false, error: `${key} must be a single value` };
  }
  const trimmed = raw.trim();
  return { ok: true, value: trimmed === '' ? undefined : trimmed };
}

/**
 * Read a query param constrained to a fixed set of values, narrowing the
 * result to the union type rather than casting. Rejects both the repeated
 * key form and out-of-set values.
 */
export function enumParam<T extends string>(
  req: Request,
  key: string,
  allowed: readonly T[],
): ParamResult<T | undefined> {
  const single = singleParam(req, key);
  if (!single.ok) return single;
  const value = single.value;
  if (value === undefined) return { ok: true, value: undefined };
  if (!(allowed as readonly string[]).includes(value)) {
    return { ok: false, error: `${key} must be one of: ${allowed.join(', ')}` };
  }
  return { ok: true, value: value as T };
}

/**
 * Resolve a set of guards, writing a 400 and returning null on the first
 * failure. Lets a handler collapse five guards into one early return:
 *
 *   const q = resolveParams(res, { transport: enumParam(...), tag: singleParam(...) });
 *   if (!q) return;
 */
export function resolveParams<T extends Record<string, ParamResult<unknown>>>(
  res: Response,
  guards: T,
): { [K in keyof T]: T[K] extends ParamResult<infer V> ? V : never } | null {
  const out: Record<string, unknown> = {};
  for (const [key, result] of Object.entries(guards)) {
    if (!result.ok) {
      badRequest(res, result.error);
      return null;
    }
    out[key] = result.value;
  }
  return out as { [K in keyof T]: T[K] extends ParamResult<infer V> ? V : never };
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
