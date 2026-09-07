// Status mapping and the health fetch.
//
// The bug this file exists to prevent: `/api/health` reports each transport in
// the transport's own vocabulary ('connected'), and a comparison against the
// service-runtime vocabulary ('healthy') is silently always-false — so a
// perfectly healthy system rendered both transports as DOWN and nothing threw.
// Every state the server can actually produce is enumerated here.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  api,
  coordinatorExplanation,
  coordinatorFromHealth,
  isAuthError,
  isTransportUp,
  transportTone,
  type ComponentHealth,
  type ServiceHealthBody,
} from './api';
import { isAuthRequired, resetAuthState } from './auth';
import { mockFetch } from './test/helpers';

/**
 * The vocabulary `signal.healthCheck()` / `durable.healthCheck()` return
 * (src/client/signal.ts, src/client/durable.ts) and that ops.ts passes through
 * to `GET /api/health` verbatim.
 */
const SERVER_STATES = ['connected', 'degraded', 'disconnected'] as const;

describe('isTransportUp', () => {
  it('treats the transport vocabulary "connected" as up', () => {
    expect(isTransportUp('connected')).toBe(true);
  });

  it('also accepts "healthy", the service-runtime spelling', () => {
    expect(isTransportUp('healthy')).toBe(true);
  });

  it.each(['degraded', 'disconnected', 'unhealthy'] as const)('treats %s as not up', (s) => {
    expect(isTransportUp(s)).toBe(false);
  });

  it('treats an unknown status as not up rather than assuming the best', () => {
    // A future server release adding a fourth state must not read as healthy.
    expect(isTransportUp('reconnecting' as ComponentHealth['status'])).toBe(false);
    expect(isTransportUp(undefined as unknown as ComponentHealth['status'])).toBe(false);
  });

  it('covers every state the server can actually emit', () => {
    expect(SERVER_STATES.map(isTransportUp)).toEqual([true, false, false]);
  });
});

describe('transportTone', () => {
  it('keeps degraded a warning, not a failure', () => {
    // Collapsing degraded into danger tells an operator to page someone for a
    // slow Redis that is still delivering every message.
    expect(transportTone('degraded')).toBe('warning');
  });

  it('maps the three server states to success / warning / danger', () => {
    expect(SERVER_STATES.map(transportTone)).toEqual(['success', 'warning', 'danger']);
  });

  it('maps an unknown status to danger', () => {
    expect(transportTone('who-knows' as ComponentHealth['status'])).toBe('danger');
  });
});

describe('api.getHealth', () => {
  const body = {
    status: 'unhealthy',
    redis: { status: 'connected', latencyMs: 3 },
    messageQueue: { status: 'disconnected' },
    uptime: 42,
    eventCount: 7,
  };

  it('returns the parsed health payload on 200', async () => {
    mockFetch({ '/api/health': { body: { ...body, status: 'healthy' } } });
    const res = await api.getHealth();
    expect(res.redis.status).toBe('connected');
  });

  it('returns the body of a 503 instead of throwing it away', async () => {
    // `GET /api/health` answers 503 precisely when a transport is
    // disconnected — the one moment the health card matters most. Treating
    // that as a failed request replaced "Message Queue: disconnected" with
    // "Error loading the dashboard", which tells the operator nothing about
    // which transport is down.
    mockFetch({ '/api/health': { status: 503, body } });
    const res = await api.getHealth();
    expect(res.status).toBe('unhealthy');
    expect(res.messageQueue.status).toBe('disconnected');
    expect(isTransportUp(res.messageQueue.status)).toBe(false);
  });

  it('still throws when a 503 carries no health body (a proxy, not the catalog)', async () => {
    mockFetch({ '/api/health': { status: 503, text: '<html>502 Bad Gateway</html>' } });
    await expect(api.getHealth()).rejects.toThrow(/503/);
  });

  it('throws on other error statuses', async () => {
    mockFetch({ '/api/health': { status: 500, text: 'boom' } });
    await expect(api.getHealth()).rejects.toThrow(/API 500/);
  });
});

describe('api error surfacing', () => {
  it('includes the status code so the view can say what went wrong', async () => {
    mockFetch({ '/api/events': { status: 500, text: 'registry exploded' } });
    await expect(api.getEvents()).rejects.toThrow('API 500: registry exploded');
  });

  it('does not swallow a network failure into an empty result', async () => {
    mockFetch({ '/api/events': { networkError: 'Failed to fetch' } });
    await expect(api.getEvents()).rejects.toThrow('Failed to fetch');
  });
});

describe('api query building', () => {
  it('omits the query string entirely when no filter is given', async () => {
    const { calls } = mockFetch({ '/api/events': { body: { events: [], total: 0 } } });
    await api.getEvents();
    expect(calls[0]).toBe('/api/events');
  });

  it('encodes event names that contain colons and slashes', async () => {
    const { calls } = mockFetch({ '/api/events': { body: {} } });
    await api.getEvent('pipeline:step/agent:tool');
    expect(calls[0]).toBe('/api/events/pipeline%3Astep%2Fagent%3Atool');
  });

  it('builds the bulk export URL from the selected names', () => {
    expect(api.bulkExportUrl(['a:b', 'c'])).toBe('/api/events/bulk/export?names=a%3Ab,c');
    expect(api.bulkExportUrl([])).toBe('/api/events/bulk/export');
  });
});

describe('api — the endpoints the views call, and how they fail', () => {
  it('reads the ROOT /metrics for Prometheus text, not /api/metrics', async () => {
    // Two different endpoints with the same last path segment: /api/metrics is
    // the per-event JSON rollup, / metrics is the Prometheus exposition. Asking
    // the wrong one hands the transport-health view a JSON blob to parse as
    // text and it silently renders nothing.
    const { calls } = mockFetch({ '/metrics': { text: 'catalog_events_total 4' } });
    await expect(api.getPromMetrics()).resolves.toContain('catalog_events_total');
    expect(calls[0]).toBe('/metrics');
  });

  it('throws on a non-2xx Prometheus scrape instead of returning an error page as metrics', async () => {
    mockFetch({ '/metrics': { status: 502, text: '<html>bad gateway</html>' } });
    await expect(api.getPromMetrics()).rejects.toThrow('API 502');
  });

  it.each([
    ['getEvents', () => api.getEvents()],
    ['getEvent', () => api.getEvent('a:b')],
    ['getTopology', () => api.getTopology()],
    ['getNamespaces', () => api.getNamespaces()],
    ['getNamespacesSummary', () => api.getNamespacesSummary('full')],
    ['getSubscribers', () => api.getSubscribers()],
    ['getMetrics', () => api.getMetrics()],
    ['getRegistryHealth', () => api.getRegistryHealth()],
    ['getDLQ', () => api.getDLQ()],
    ['getPoisonedEvents', () => api.getPoisonedEvents()],
    ['listDeprecated', () => api.listDeprecated()],
    ['getSignalChannels', () => api.getSignalChannels()],
    ['getDurableQueues', () => api.getDurableQueues()],
  ])('%s rejects on a 500 rather than resolving to an empty result', async (_name, call) => {
    // The one shape a view must never see from a broken server is a
    // well-formed empty payload — that is what renders as "nothing declared".
    mockFetch({ '/api': { status: 500, text: 'boom' } });
    await expect(call()).rejects.toThrow('API 500: boom');
  });

  it.each([
    ['declareEvent', () => api.declareEvent({ name: 'a:b', transport: 'signal', producer: 'svc' })],
    ['deleteEvent', () => api.deleteEvent('a:b')],
    ['deprecateEvent', () => api.deprecateEvent('a:b', { reason: 'x' })],
    ['undeprecateEvent', () => api.undeprecateEvent('a:b')],
    ['replayDLQ', () => api.replayDLQ('id-1')],
    ['batchReplayDLQ', () => api.batchReplayDLQ(['id-1'])],
    ['deleteDLQ', () => api.deleteDLQ('id-1')],
    ['clearDLQ', () => api.clearDLQ()],
    ['bulkDeprecate', () => api.bulkDeprecate(['a:b'])],
    ['clearPoison', () => api.clearPoison('a:b')],
  ])('%s surfaces a rejected write instead of reporting success', async (_name, call) => {
    mockFetch({ '/api': { status: 409, text: 'incompatible schema change' } });
    await expect(call()).rejects.toThrow('API 409: incompatible schema change');
  });

  it('omits the staleAfter filter unless one was asked for', async () => {
    const { calls } = mockFetch({ '/api/subscribers': { body: { subscribers: [], total: 0 } } });
    await api.getSubscribers();
    await api.getSubscribers(0);
    await api.getSubscribers(600);
    expect(calls).toEqual(['/api/subscribers', '/api/subscribers', '/api/subscribers?staleAfter=600']);
  });

  it('asks for the full namespace payload only when the caller wants events', async () => {
    const { calls } = mockFetch({ '/api/namespaces/summary': { body: { count: 0, items: [] } } });
    await api.getNamespacesSummary();
    await api.getNamespacesSummary('full');
    expect(calls).toEqual(['/api/namespaces/summary', '/api/namespaces/summary?detail=full']);
  });

  it('always sends a DLQ limit, and scopes to one event when asked', async () => {
    const { calls } = mockFetch({ '/api/transports/durable/dlq': { body: { messages: [], total: 0 } } });
    await api.getDLQ();
    await api.getDLQ('call:caption:line', 10);
    expect(calls[0]).toBe('/api/transports/durable/dlq?limit=100');
    expect(calls[1]).toBe('/api/transports/durable/dlq?eventName=call%3Acaption%3Aline&limit=10');
  });

  it('encodes the event name in every per-event path', async () => {
    const { calls } = mockFetch({ '/api': { body: {} } });
    const name = 'pipeline:step/agent:tool';
    await api.getEventStats(name);
    await api.getEventHistory(name);
    await api.deprecateEvent(name);
    await api.clearPoison(name);
    await api.getObservedProducers(name);
    await api.getMetricsHistory(name);
    expect(calls.every((c) => !c.includes('pipeline:step'))).toBe(true);
    expect(calls[0]).toBe('/api/events/pipeline%3Astep%2Fagent%3Atool/stats');
    expect(calls[5]).toBe('/api/metrics/history?eventName=pipeline%3Astep%2Fagent%3Atool');
  });

  it('sends the ids a batch redrive was asked for', async () => {
    const { fn } = mockFetch({ '/api/transports/durable/dlq/replay': { body: { replayed: [], failed: [], total: 0 } } });
    await api.batchReplayDLQ(['a', 'b']);
    expect(JSON.parse(String((fn.mock.calls[0]![1] as RequestInit).body))).toEqual({ ids: ['a', 'b'] });
  });

  it('scopes a DLQ clear to one event when given one', async () => {
    const { calls } = mockFetch({ '/api/transports/durable/dlq/clear': { body: { cleared: 0 } } });
    await api.clearDLQ();
    await api.clearDLQ('a:b');
    expect(calls).toEqual([
      '/api/transports/durable/dlq/clear',
      '/api/transports/durable/dlq/clear?eventName=a%3Ab',
    ]);
  });

  it('asks for the whole metrics history when no event is named', async () => {
    const { calls } = mockFetch({ '/api/metrics/history': { body: {} } });
    await api.getMetricsHistory();
    expect(calls[0]).toBe('/api/metrics/history');
  });

  it('passes topology filters through, and omits the ones not set', async () => {
    const { calls } = mockFetch({ '/api/topology': { body: { nodes: [], edges: [] } } });
    await api.getTopology({ namespace: 'call' });
    await api.getTopology({ producer: 'platform-api', transport: 'durable' });
    await api.getTopology({});
    expect(calls).toEqual([
      '/api/topology?namespace=call',
      '/api/topology?producer=platform-api&transport=durable',
      '/api/topology',
    ]);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ─────────────────────────────────────────────────────────────────────────────
// Bearer auth (EVENT_CATALOG_AUTH_TOKEN), and the coordinator on root /health.
// ─────────────────────────────────────────────────────────────────────────────

describe('a 401 from the auth gate', () => {
  /** Every mutating call the server's `requiresAuth` would challenge. */
  const MUTATIONS: Array<[string, () => Promise<unknown>]> = [
    ['declareEvent', () => api.declareEvent({ name: 'a:b', transport: 'signal', producer: 'svc' })],
    ['deleteEvent', () => api.deleteEvent('a:b')],
    ['deprecateEvent', () => api.deprecateEvent('a:b', { reason: 'x' })],
    ['undeprecateEvent', () => api.undeprecateEvent('a:b')],
    ['bulkDeprecate', () => api.bulkDeprecate(['a:b'])],
    ['replayDLQ', () => api.replayDLQ('id-1')],
    ['batchReplayDLQ', () => api.batchReplayDLQ(['id-1'])],
    ['deleteDLQ', () => api.deleteDLQ('id-1')],
    ['clearDLQ', () => api.clearDLQ()],
    ['clearPoison', () => api.clearPoison('a:b')],
  ];

  it.each(MUTATIONS)('%s says what is wrong, not "API 401"', async (_name, call) => {
    // What the views render is `err.message`. Before this, all ten of them
    // showed `API 401: {"error":"Unauthorized"}` — a string that names neither
    // the cause nor anything the operator can do.
    mockFetch({ '/api': { status: 401, text: '{"error":"Unauthorized"}' } });
    await expect(call()).rejects.toThrow(/requires an API token/i);
    await expect(call()).rejects.not.toThrow(/^API 401/);
  });

  it('carries the status so a caller can branch without matching on prose', async () => {
    mockFetch({ '/api': { status: 401, text: '{"error":"Unauthorized"}' } });
    const err = await api.clearDLQ().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(401);
    expect(isAuthError(err)).toBe(true);
  });

  it('does not mistake other failures for the auth gate', async () => {
    mockFetch({ '/api': { status: 403, text: 'forbidden by policy' } });
    const err = await api.clearDLQ().catch((e) => e);
    expect(isAuthError(err)).toBe(false);
    expect((err as Error).message).toBe('API 403: forbidden by policy');
  });

  it('trips the app-wide latch so every other view can say so too', async () => {
    expect(isAuthRequired()).toBe(false);
    mockFetch({ '/api': { status: 401, text: '' } });
    await api.replayDLQ('id-1').catch(() => {});
    expect(isAuthRequired()).toBe(true);
    resetAuthState();
  });

  it('never puts a credential on the wire — there is none to put', async () => {
    const { fn } = mockFetch({ '/api': { body: { cleared: 0 } } });
    await api.clearDLQ();
    const init = fn.mock.calls[0]?.[1] as RequestInit | undefined;
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((k) => k.toLowerCase())).not.toContain('authorization');
  });
});

describe('coordinatorFromHealth', () => {
  const body = (status: string, details?: unknown): ServiceHealthBody => ({
    service: 'event-catalog',
    version: '0.6.0',
    status: status === 'healthy' ? 'healthy' : 'degraded',
    checks: [
      { id: 'redis', status: 'healthy', durationMs: 1 },
      { id: 'message-queue', status: 'healthy', durationMs: 1 },
      { id: 'registry', status: 'healthy', durationMs: 0, details: { eventCount: 229 } },
      { id: 'coordinator', status: status as 'healthy' | 'degraded' | 'unhealthy', durationMs: 0, ...(details !== undefined ? { details } : {}) },
    ],
    timestamp: new Date().toISOString(),
  });

  it('picks the coordinator check out by id, not by position', () => {
    const found = coordinatorFromHealth(body('degraded', { stale: true, peers: 2 }));
    expect(found).toEqual({ status: 'degraded', stats: { stale: true, peers: 2 } });
  });

  it('returns null — not a green light — when the check is absent', () => {
    // "We did not ask" and "the replicas agree" must never render the same
    // way. An older server, or a proxy that forwards only /api, produces this.
    const withoutCoordinator = { ...body('healthy'), checks: body('healthy').checks.filter((c) => c.id !== 'coordinator') };
    expect(coordinatorFromHealth(withoutCoordinator)).toBeNull();
    expect(coordinatorFromHealth(null)).toBeNull();
  });

  it('survives a check with no details at all', () => {
    expect(coordinatorFromHealth(body('healthy'))).toEqual({ status: 'healthy', stats: {} });
  });
});

describe('coordinatorExplanation', () => {
  it('says a degraded replica may be serving the wrong contracts', () => {
    const text = coordinatorExplanation('degraded');
    expect(text).toMatch(/stale replica/i);
    expect(text).toMatch(/out of date|missing/i);
    expect(text).toMatch(/differ from what another replica serves/i);
  });

  it('does not describe degraded and unhealthy the same way', () => {
    // They are different failures: one means "what you are reading may be
    // wrong", the other means "replication is not running at all".
    expect(coordinatorExplanation('degraded')).not.toBe(coordinatorExplanation('unhealthy'));
    expect(coordinatorExplanation('healthy')).toMatch(/applied every registry mutation/i);
  });
});

describe('api.getServiceHealth', () => {
  const ok = {
    service: 'event-catalog',
    version: '0.6.0',
    status: 'degraded',
    checks: [{ id: 'coordinator', status: 'degraded', durationMs: 0, details: { stale: true } }],
    timestamp: '2026-09-07T00:00:00.000Z',
  };

  it('reads the ROOT /health, not /api/health', async () => {
    const { calls } = mockFetch({ '/health': { body: ok } });
    await api.getServiceHealth();
    expect(calls[0]).toBe('/health');
  });

  it('keeps a 503 body — an unhealthy check is exactly what is worth showing', async () => {
    mockFetch({ '/health': { status: 503, body: { ...ok, status: 'unhealthy' } } });
    await expect(api.getServiceHealth()).resolves.toMatchObject({ status: 'unhealthy' });
  });

  it('resolves to null when the deployment does not expose the root route', async () => {
    // Behind a proxy that forwards only /api. The card says "not reported";
    // the page must not break.
    mockFetch({ '/health': { status: 404, text: 'not found' } });
    await expect(api.getServiceHealth()).resolves.toBeNull();
  });

  it('resolves to null on a proxy error page rather than throwing mid-render', async () => {
    mockFetch({ '/health': { status: 503, text: '<html>gateway timeout</html>' } });
    await expect(api.getServiceHealth()).resolves.toBeNull();
  });
});
