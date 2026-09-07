// tests/routes-query-guards.test.ts
//
// Two classes of route bug, and the guards that now cover them.
//
// 1. Repeated query keys. `parseQuery` turns `?transport=a&transport=b` into
//    a `string[]`. Handlers that cast it with `as string` leaked that array
//    into the registry filters, where it matched nothing — so a malformed
//    request came back as a clean, empty, *plausible* result. Handlers that
//    guarded with `typeof x === 'string'` failed the other way: the filter
//    silently vanished and the response widened to everything. Both are now
//    a 400, matching the guard the DLQ handlers already had.
//
// 2. `GET /events/:name/schema/check` required a JSON body on a GET, which
//    browsers cannot send and many proxies drop. POST is now the canonical
//    form; the GET route takes a URL-encoded JSON `?schema=` param.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp(overrides: Partial<RoutesDeps> = {}) {
  const deps: RoutesDeps = {
    registry: new Registry(),
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
    } as unknown as RoutesDeps['signal'],
    durable: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
      publish: vi.fn(),
    } as unknown as RoutesDeps['durable'],
    dlqStore: {
      list: vi.fn(async () => []),
      remove: vi.fn(async () => true),
      findById: vi.fn(async () => null),
      put: vi.fn(),
      clear: vi.fn(),
    } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    ...overrides,
  };

  const app = expressLikeApp();
  app.use('/api', createRoutes(deps));
  return { app, deps };
}

function seed(registry: Registry): void {
  registry.declare({
    name: 'orders.placed',
    schema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
    transport: 'durable',
    producer: 'platform-api',
    tags: ['billing'],
  });
  registry.declare({
    name: 'user.created',
    schema: { type: 'object' },
    transport: 'signal',
    producer: 'gateway',
    tags: ['identity'],
  });
}

// ─── GET /api/events — repeated keys ─────────────────────────────────────────

describe('GET /api/events — single-valued filter guards', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    seed(registry);
  });

  it('still filters normally on a single ?transport=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events?transport=signal');
    expect(res.status).toBe(200);
    expect(res.body.events.map((e: { name: string }) => e.name)).toEqual(['user.created']);
  });

  it('rejects a repeated ?transport= instead of leaking an array into the filter', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events?transport=signal&transport=durable');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('transport');
    // The pre-fix behavior was a 200 with an empty list — a malformed
    // request that reads as "there are no events".
    expect(res.body.events).toBeUndefined();
  });

  it.each(['producer', 'subscriber', 'tag', 'namespace'])(
    'rejects a repeated ?%s=',
    async param => {
      const { app } = createApp({ registry });
      const res = await request(app).get(`/api/events?${param}=a&${param}=b`);
      expect(res.status).toBe(400);
      expect(res.body.error).toContain(param);
    },
  );

  it('rejects a ?transport= outside the declared enum', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events?transport=carrier-pigeon');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('signal');
  });

  it('accepts transport=both, which is a real TransportType', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events?transport=both');
    expect(res.status).toBe(200);
  });
});

// ─── Other handlers carrying the same bug class ──────────────────────────────

describe('repeated-key guards across the rest of the route table', () => {
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    seed(registry);
  });

  it('GET /api/events/bulk/export rejects a repeated ?names= (used to export EVERYTHING)', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events/bulk/export?names=user.created&names=orders.placed');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('names');
  });

  it('GET /api/events/bulk/export still honors the comma-separated form', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events/bulk/export?names=user.created');
    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(1);
  });

  it('GET /api/events/:name rejects a repeated ?version=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events/user.created?version=1&version=2');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('version');
  });

  it('GET /api/events/:name/history rejects a repeated ?count=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events/user.created/history?count=10&count=20');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('count');
  });

  it('GET /api/topology rejects a repeated ?producer= (used to widen back to the full graph)', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/topology?producer=gateway&producer=platform-api');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('producer');
  });

  it('GET /api/topology still filters on a single ?producer=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/topology?producer=gateway');
    expect(res.status).toBe(200);
  });

  it('GET /api/metrics/history rejects a repeated ?eventName=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/metrics/history?eventName=a&eventName=b');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('eventName');
  });

  it('GET /api/subscribers ignores a repeated ?staleAfter= rather than filtering on "30,60"', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/subscribers?staleAfter=30&staleAfter=60');
    // parseInt('30,60') used to yield 30 — a filter the caller never asked for.
    expect(res.status).toBe(200);
    expect(res.body.filter).toBeUndefined();
  });

  it('GET /api/namespaces/summary ignores a repeated ?detail=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/namespaces/summary?detail=full&detail=full');
    expect(res.status).toBe(200);
    expect(res.body.items[0].events).toBeUndefined();
  });
});

// ─── schema/check: POST is canonical, GET takes ?schema= ─────────────────────

describe('/api/events/:name/schema/check — no body required on a GET', () => {
  let registry: Registry;

  const compatible = {
    type: 'object',
    properties: { orderId: { type: 'string' }, amount: { type: 'number' } },
    required: ['orderId'],
  };
  const breaking = { type: 'object', properties: {}, required: ['orderId', 'shipperId'] };

  beforeEach(() => {
    registry = new Registry();
    seed(registry);
  });

  it('POST with the schema in the body is the canonical form', async () => {
    const { app } = createApp({ registry });
    const res = await request(app)
      .post('/api/events/orders.placed/schema/check')
      .send({ schema: compatible });
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(true);
    expect(res.body.eventName).toBe('orders.placed');
    expect(typeof res.body.currentVersion).toBe('number');
  });

  it('POST reports an incompatible schema without mutating the registry', async () => {
    const { app } = createApp({ registry });
    const before = registry.get('orders.placed')?.version;
    const res = await request(app)
      .post('/api/events/orders.placed/schema/check')
      .send({ schema: breaking });
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(false);
    expect(registry.get('orders.placed')?.version).toBe(before);
  });

  it('POST 404s for an unknown event', async () => {
    const { app } = createApp({ registry });
    const res = await request(app)
      .post('/api/events/no.such.event/schema/check')
      .send({ schema: compatible });
    expect(res.status).toBe(404);
  });

  it('GET works with a URL-encoded ?schema= and no request body at all', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get(
      `/api/events/orders.placed/schema/check?schema=${encodeURIComponent(JSON.stringify(compatible))}`,
    );
    expect(res.status).toBe(200);
    expect(res.body.compatible).toBe(true);
  });

  it('GET 400s on an unparseable ?schema=', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).get('/api/events/orders.placed/schema/check?schema=not-json');
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('schema');
  });

  it('400s when the schema is a JSON array rather than an object', async () => {
    const { app } = createApp({ registry });
    const res = await request(app)
      .post('/api/events/orders.placed/schema/check')
      .send({ schema: [1, 2, 3] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('JSON object');
  });

  it('400s with a message naming both transports when nothing is supplied', async () => {
    const { app } = createApp({ registry });
    const res = await request(app).post('/api/events/orders.placed/schema/check').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('schema is required');
  });
});
