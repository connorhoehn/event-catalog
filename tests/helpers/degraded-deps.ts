// tests/helpers/degraded-deps.ts
//
// Shared fixtures for the `resilience-*` suites.
//
// These suites exercise dependencies that are DEGRADED rather than
// absent — a DynamoDB that throttles, a message-queue that accepts the
// connection and then never answers, a Redis that has stopped serving
// but has not been marked disconnected. "Down" is well covered
// elsewhere in this suite; the in-between states are where the
// expensive bugs live, so the fakes here are shaped to reproduce them
// precisely and deterministically (no real sleeps, no wall-clock
// dependence).

import { vi } from 'vitest';
import { Registry } from '../../src/registry/index.js';
import { MetricsCollector } from '../../src/server/metrics.js';
import type { RoutesDeps } from '../../src/server/routes.js';
import type { DLQEntry } from '../../src/server/dlq-store.js';

/**
 * The error a throttled DynamoDB actually raises. Distinct from an
 * outage: the table is up, the credentials are fine, the call simply
 * fails and would succeed on retry. Code that treats it as "the store
 * is empty" reports a clean DLQ during the incident.
 */
export function provisionedThroughputExceeded(): Error {
  const err = new Error(
    'The level of configured provisioned throughput for the table was exceeded. '
    + 'Consider increasing your provisioning level with the UpdateTable API. '
    + '(Service: DynamoDb, Status Code: 400, Request ID: 7Q8V…)',
  );
  err.name = 'ProvisionedThroughputExceededException';
  return err;
}

/** A Redis client whose socket has gone away mid-session. */
export function connectionIsClosed(): Error {
  return new Error('Connection is closed.');
}

/** One persisted DLQ row, as `DLQStore` shapes it. */
export function storeEntry(seq: number, eventName = 'orders:failed'): DLQEntry {
  const deadAt = new Date(1_700_000_000_000 + seq * 60_000).toISOString();
  return {
    id: `entry-${seq}`,
    pk: `DLQ#${eventName}`,
    sk: `${deadAt}#entry-${seq}`,
    eventName,
    payload: { seq },
    error: 'handler threw',
    attempts: 3,
    deadAt,
    ttl: Math.floor(1_700_000_000_000 / 1000) + 30 * 86400,
  };
}

/**
 * One in-process mirror row, as `DurableTransport.getDLQ()` shapes it.
 * The mirror is append-ordered: index 0 is the OLDEST entry it holds.
 */
export function mirrorEntry(seq: number, eventName = 'orders:failed') {
  return {
    messageId: `entry-${seq}`,
    queueName: 'orders-failed',
    envelope: {
      eventName,
      payload: { seq },
      metadata: { id: `entry-${seq}`, producer: 'worker', timestamp: 0 },
    },
    error: 'handler threw',
    attempts: 3,
    deadLetteredAt: new Date(1_700_000_000_000 + seq * 60_000).toISOString(),
  };
}

export interface DegradedDepsOverrides {
  registry?: Registry;
  dlqStore?: Partial<RoutesDeps['dlqStore']>;
  durable?: Partial<RoutesDeps['durable']>;
  signal?: Partial<RoutesDeps['signal']>;
  auditLog?: RoutesDeps['auditLog'];
  manifestStore?: RoutesDeps['manifestStore'];
}

/**
 * `RoutesDeps` with every dependency healthy, so a suite only has to
 * describe the ONE thing that is degraded.
 */
export function makeRoutesDeps(overrides: DegradedDepsOverrides = {}): RoutesDeps {
  const registry = overrides.registry ?? new Registry();

  const deps = {
    registry,
    metrics: new MetricsCollector(),
    metricsObserver: {
      refreshSubscriberCount: vi.fn(),
      syncSubscriberCounts: vi.fn(),
      observe: vi.fn(async () => {}),
    } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
      ...overrides.signal,
    } as unknown as RoutesDeps['signal'],
    durable: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
      publish: vi.fn(async () => {}),
      ...overrides.durable,
    } as unknown as RoutesDeps['durable'],
    dlqStore: {
      list: vi.fn(async () => []),
      remove: vi.fn(async () => true),
      findById: vi.fn(async () => null),
      put: vi.fn(async () => storeEntry(0)),
      clear: vi.fn(async () => 0),
      ...overrides.dlqStore,
    } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  } as RoutesDeps;

  if (overrides.auditLog) deps.auditLog = overrides.auditLog;
  if (overrides.manifestStore) deps.manifestStore = overrides.manifestStore;
  return deps;
}

/**
 * A `fetch` stand-in for the message-queue HTTP surface.
 *
 * `handler` sees only the interesting calls: the queue-ensure PUT and
 * the `/health` probe are answered for you, because every publish makes
 * them and no test is about them.
 */
export function messageQueueFetch(
  handler: (url: string, init?: RequestInit) => unknown,
): ReturnType<typeof vi.fn> {
  return vi.fn(async (url: string | URL, init?: RequestInit) => {
    const s = String(url);
    if (init?.method === 'PUT') {
      return { status: 201, ok: true, json: async () => ({}), text: async () => '' };
    }
    if (s.endsWith('/health')) {
      return { ok: true, status: 200, json: async () => ({}), text: async () => 'ok' };
    }
    return handler(s, init);
  });
}

/** Minimal `Response`-alike for the durable transport's fetch calls. */
export function httpResponse(
  status: number,
  body: unknown = {},
  headerEntries: Record<string, string> = {},
): unknown {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k: string) => headerEntries[k.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

/** A promise that never settles — a dependency that is slow, not dead. */
export function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}
