// tests/dlq-auth-and-replay-validation.test.ts
//
// Dead-letter entries carry other services' payloads, and a replay is
// re-published under the catalog's own service identity. So:
//
//   * with auth configured, every DLQ route — reads included — needs the
//     bearer token (the gate used to wave every GET through);
//   * the server refuses to start with the message-queue secret set and no
//     catalog token, because that combination signs replays for anyone;
//   * a replay re-validates the stored payload against the event's current
//     schema and refuses an invalid one instead of publishing it.

import { afterEach, describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { resolveAuthMiddleware } from '../src/server/auth.js';
import { startServer } from '../src/server/index.js';

const TOKEN = 'c0ffee0123456789abcdef0123456789';

function makeRegistry(): Registry {
  const reg = new Registry();
  reg.declare({
    name: 'orders.failed',
    transport: 'durable',
    producer: 'order-service',
    schema: {
      type: 'object',
      properties: { orderId: { type: 'string' } },
      required: ['orderId'],
    },
  });
  return reg;
}

function makeEntry(id: string, payload: unknown, eventName = 'orders.failed') {
  return {
    id,
    pk: `DLQ#${eventName}`,
    sk: `2026-05-15T00:00:00.000Z#${id}`,
    eventName,
    payload,
    error: 'timeout',
    attempts: 3,
    deadAt: '2026-05-15T00:00:00.000Z',
    ttl: 1_700_000_000,
  };
}

function build(opts: { auth?: boolean; entries?: ReturnType<typeof makeEntry>[] } = {}) {
  const entries = new Map((opts.entries ?? []).map((e) => [e.id, e]));
  const dlqStore = {
    list: vi.fn(async () => [...entries.values()]),
    remove: vi.fn(async (id: string) => entries.delete(id)),
    findById: vi.fn(async (id: string) => entries.get(id) ?? null),
    put: vi.fn(),
    clear: vi.fn(async () => 0),
  } as unknown as RoutesDeps['dlqStore'];
  const publish = vi.fn(async () => {});
  const deps: RoutesDeps = {
    registry: makeRegistry(),
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
      publish,
    } as unknown as RoutesDeps['durable'],
    dlqStore,
    startedAt: Date.now(),
  };
  const app = expressLikeApp();
  // The real pipeline: the gate on /api ahead of the routers.
  const gate = resolveAuthMiddleware(undefined, opts.auth === false ? undefined : TOKEN);
  if (gate) app.use('/api', gate);
  app.use('/api', createRoutes(deps));
  return { app, publish, dlqStore };
}

describe('DLQ routes with auth configured', () => {
  it('rejects an unauthenticated GET on the dead-letter route with 401', async () => {
    const { app, dlqStore } = build({ entries: [makeEntry('e1', { orderId: 'o1' })] });
    const res = await request(app).get('/api/transports/durable/dlq');
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain('o1');
    expect(dlqStore.list).not.toHaveBeenCalled();
  });

  it('rejects an unauthenticated HEAD on the dead-letter route', async () => {
    const { app } = build();
    expect((await request(app).head('/api/transports/durable/dlq')).status).toBe(401);
  });

  it.each([
    ['post', '/api/transports/durable/dlq/e1/replay'],
    ['post', '/api/transports/durable/dlq/replay'],
    ['post', '/api/transports/durable/dlq/clear'],
    ['delete', '/api/transports/durable/dlq/e1'],
  ] as const)('rejects unauthenticated %s %s', async (method, path) => {
    const { app, publish } = build({ entries: [makeEntry('e1', { orderId: 'o1' })] });
    expect((await request(app)[method](path).send({ ids: ['e1'] })).status).toBe(401);
    expect(publish).not.toHaveBeenCalled();
  });

  it('serves the dead-letter list to a caller with the token', async () => {
    const { app } = build({ entries: [makeEntry('e1', { orderId: 'o1' })] });
    const res = await request(app).get('/api/transports/durable/dlq')
      .set('Authorization', `Bearer ${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.messages).toHaveLength(1);
  });

  it('gates other reads too, but leaves the health route open', async () => {
    const { app } = build();
    expect((await request(app).get('/api/events')).status).toBe(401);
    expect((await request(app).get('/api/health')).status).not.toBe(401);
  });
});

describe('DLQ replay re-validates the payload', () => {
  const auth = { Authorization: `Bearer ${TOKEN}` };

  it('refuses to replay an entry whose payload fails the schema', async () => {
    const { app, publish, dlqStore } = build({ entries: [makeEntry('bad', { orderId: 42 })] });
    const res = await request(app).post('/api/transports/durable/dlq/bad/replay').set(auth).send({});
    expect(res.status).toBe(422);
    expect(res.body.error).toBe('ReplayRejected');
    expect(publish).not.toHaveBeenCalled();
    expect(dlqStore.remove).not.toHaveBeenCalled();
  });

  it('refuses to replay an entry for an undeclared event', async () => {
    const { app, publish } = build({ entries: [makeEntry('ghost', { a: 1 }, 'ghost.event')] });
    const res = await request(app).post('/api/transports/durable/dlq/ghost/replay').set(auth).send({});
    expect(res.status).toBe(422);
    expect(publish).not.toHaveBeenCalled();
  });

  it('replays a valid entry', async () => {
    const { app, publish, dlqStore } = build({ entries: [makeEntry('good', { orderId: 'o1' })] });
    const res = await request(app).post('/api/transports/durable/dlq/good/replay').set(auth).send({});
    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledOnce();
    expect(dlqStore.remove).toHaveBeenCalledWith('good');
  });

  it('batch replay publishes the valid entries and reports the invalid ones as failed', async () => {
    const { app, publish, dlqStore } = build({
      entries: [makeEntry('good', { orderId: 'o1' }), makeEntry('bad', { orderId: 42 })],
    });
    const res = await request(app).post('/api/transports/durable/dlq/replay').set(auth)
      .send({ ids: ['good', 'bad'] });
    expect(res.status).toBe(200);
    expect(res.body.replayed).toEqual([{ id: 'good', eventName: 'orders.failed' }]);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].id).toBe('bad');
    expect(res.body.failed[0].error).toMatch(/schema/i);
    expect(publish).toHaveBeenCalledOnce();
    expect(dlqStore.remove).not.toHaveBeenCalledWith('bad');
  });
});

describe('boot: the queue secret requires a catalog token', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('refuses to start with MQ_SERVICE_AUTH_SECRET set and no EVENT_CATALOG_AUTH_TOKEN', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('EVENT_CATALOG_AUTH_TOKEN', undefined);
    vi.stubEnv('MQ_SERVICE_AUTH_SECRET', 'queue-secret-0123456789abcdef');
    await expect(startServer({ redisUrl: 'redis://127.0.0.1:1', messageQueueUrl: 'http://127.0.0.1:1' }))
      .rejects.toThrow(/EVENT_CATALOG_AUTH_TOKEN/);
  });
});
