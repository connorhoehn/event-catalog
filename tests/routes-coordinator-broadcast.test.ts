// tests/routes-coordinator-broadcast.test.ts
//
// Guards the wave26-d coordinator broadcast wiring in routes.ts.
// Every mutating route calls coordinator?.broadcast(kind, payload) so
// peer replicas can converge. These tests verify the kind + payload
// shape for each of the 6 single-event broadcast points.
//
// If a broadcast call is accidentally dropped from a route, tests
// here fail before the regression ships.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import type { RegistryCoordinator } from '../src/server/registry-coordinator.js';

function makeCoordinator() {
  return { broadcast: vi.fn(async () => {}) } as unknown as RegistryCoordinator;
}

function createApp(coordinator: RegistryCoordinator | undefined, registry: Registry) {
  const app = expressLikeApp();
  app.use('/api', createRoutes({
    registry,
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
    durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
    startedAt: Date.now(),
    coordinator,
  } as unknown as RoutesDeps));
  return app;
}

const BASE_DECL = {
  name: 'test.event',
  schema: { type: 'object' },
  transport: 'signal',
  producer: 'test-svc',
};

describe('routes → coordinator.broadcast wiring (wave26-d)', () => {
  let coordinator: ReturnType<typeof makeCoordinator>;
  let registry: Registry;
  let app: ReturnType<typeof expressLikeApp>;

  beforeEach(() => {
    coordinator = makeCoordinator();
    registry = new Registry();
    app = createApp(coordinator, registry);
  });

  it('POST /api/events broadcasts "declare" with the registry entry', async () => {
    await request(app).post('/api/events').send(BASE_DECL).expect(201);
    expect(coordinator.broadcast).toHaveBeenCalledOnce();
    const [kind, payload] = (coordinator.broadcast as ReturnType<typeof vi.fn>).mock.calls[0] as [string, { name: string }];
    expect(kind).toBe('declare');
    expect(payload.name).toBe('test.event');
  });

  it('DELETE /api/events/:name broadcasts "remove" with { name }', async () => {
    registry.declare(BASE_DECL);
    await request(app).delete('/api/events/test.event').expect(200);
    expect(coordinator.broadcast).toHaveBeenCalledWith('remove', { name: 'test.event' });
  });

  it('POST /api/events/:name/subscribers broadcasts "subscriber.add"', async () => {
    registry.declare(BASE_DECL);
    await request(app)
      .post('/api/events/test.event/subscribers')
      .send({ serviceName: 'consumer-svc' })
      .expect(201);
    expect(coordinator.broadcast).toHaveBeenCalledWith('subscriber.add', {
      eventName: 'test.event',
      serviceName: 'consumer-svc',
    });
  });

  it('DELETE /api/events/:name/subscribers/:serviceName broadcasts "subscriber.remove"', async () => {
    registry.declare(BASE_DECL);
    registry.addSubscriber('test.event', 'consumer-svc');
    await request(app).delete('/api/events/test.event/subscribers/consumer-svc').expect(200);
    expect(coordinator.broadcast).toHaveBeenCalledWith('subscriber.remove', {
      eventName: 'test.event',
      serviceName: 'consumer-svc',
    });
  });

  it('POST /api/events/:name/deprecate broadcasts "deprecate" with opts', async () => {
    registry.declare(BASE_DECL);
    await request(app)
      .post('/api/events/test.event/deprecate')
      .send({ reason: 'use new.event', by: 'ops-team' })
      .expect(200);
    expect(coordinator.broadcast).toHaveBeenCalledWith('deprecate', {
      name: 'test.event',
      opts: { reason: 'use new.event', by: 'ops-team' },
    });
  });

  it('DELETE /api/events/:name/deprecate broadcasts "undeprecate"', async () => {
    registry.declare(BASE_DECL);
    registry.deprecate('test.event');
    await request(app).delete('/api/events/test.event/deprecate').expect(200);
    expect(coordinator.broadcast).toHaveBeenCalledWith('undeprecate', { name: 'test.event' });
  });

  it('coordinator absent → routes still work, no crash', async () => {
    const appNoBroadcast = createApp(undefined, new Registry());
    const res = await request(appNoBroadcast).post('/api/events').send(BASE_DECL);
    expect(res.status).toBe(201);
    expect(coordinator.broadcast).not.toHaveBeenCalled();
  });

  it('POST /api/events/bulk broadcasts "declare" once per event in the batch', async () => {
    await request(app)
      .post('/api/events/bulk')
      .send({
        serviceName: 'batch-svc',
        events: [
          { name: 'bulk.one', schema: { type: 'object' }, transport: 'signal' },
          { name: 'bulk.two', schema: { type: 'object' }, transport: 'durable' },
        ],
      })
      .expect(201);
    expect(coordinator.broadcast).toHaveBeenCalledTimes(2);
    const kinds = (coordinator.broadcast as ReturnType<typeof vi.fn>).mock.calls.map(([k]) => k);
    expect(kinds).toEqual(['declare', 'declare']);
    const names = (coordinator.broadcast as ReturnType<typeof vi.fn>).mock.calls.map(
      ([, p]) => (p as { name: string }).name,
    );
    expect(names).toEqual(expect.arrayContaining(['bulk.one', 'bulk.two']));
  });

  it('POST /api/events/bulk/deprecate broadcasts "deprecate" once per deprecated event', async () => {
    registry.declare({ name: 'dep.one', schema: {}, transport: 'signal', producer: 'svc' });
    registry.declare({ name: 'dep.two', schema: {}, transport: 'signal', producer: 'svc' });
    await request(app)
      .post('/api/events/bulk/deprecate')
      .send({ names: ['dep.one', 'dep.two'], reason: 'sunset', by: 'ops' })
      .expect(200);
    expect(coordinator.broadcast).toHaveBeenCalledTimes(2);
    const calls = (coordinator.broadcast as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.every(([k]) => k === 'deprecate')).toBe(true);
    expect(calls.map(([, p]) => (p as { name: string }).name)).toEqual(
      expect.arrayContaining(['dep.one', 'dep.two']),
    );
  });
});
