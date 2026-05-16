import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp() {
  const registry = new Registry();
  const metrics = new MetricsCollector(60);

  registry.declare({ name: 'user.signed-up', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
  registry.declare({ name: 'user.deleted', transport: 'durable', producer: 'platform-api', schema: { type: 'object' } });
  registry.declare({ name: 'order.placed', transport: 'durable', producer: 'orders-svc', schema: { type: 'object' } });

  const deps = {
    registry,
    metrics,
    signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] },
    durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() },
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    dlqStore: {} as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  } as RoutesDeps;

  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(deps));
  return { app, registry };
}

describe('POST /api/events/bulk/deprecate', () => {
  it('bulk-deprecates multiple events with a shared reason', async () => {
    const { app, registry } = createApp();

    const res = await request(app)
      .post('/api/events/bulk/deprecate')
      .send({ names: ['user.signed-up', 'user.deleted'], reason: 'legacy auth', by: 'ops-team' });

    expect(res.status).toBe(200);
    expect(res.body.deprecated).toContain('user.signed-up');
    expect(res.body.deprecated).toContain('user.deleted');
    expect(res.body.total).toBe(2);
    expect(res.body.notFound).toHaveLength(0);

    const entry = registry.get('user.signed-up');
    expect(entry?.deprecation?.reason).toBe('legacy auth');
    expect(entry?.deprecation?.by).toBe('ops-team');
  });

  it('reports notFound events separately', async () => {
    const { app } = createApp();

    const res = await request(app)
      .post('/api/events/bulk/deprecate')
      .send({ names: ['user.signed-up', 'no.such.event'] });

    expect(res.status).toBe(200);
    expect(res.body.deprecated).toContain('user.signed-up');
    expect(res.body.notFound).toContain('no.such.event');
  });

  it('returns 400 when all events not found', async () => {
    const { app } = createApp();

    const res = await request(app)
      .post('/api/events/bulk/deprecate')
      .send({ names: ['no.such.a', 'no.such.b'] });

    expect(res.status).toBe(400);
  });

  it('returns 400 when names is missing', async () => {
    const { app } = createApp();

    const res = await request(app).post('/api/events/bulk/deprecate').send({});
    expect(res.status).toBe(400);
  });

  it('returns 400 when names is empty array', async () => {
    const { app } = createApp();

    const res = await request(app).post('/api/events/bulk/deprecate').send({ names: [] });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/events/bulk/export', () => {
  it('exports all events when no names param provided', async () => {
    const { app } = createApp();

    const res = await request(app).get('/api/events/bulk/export');
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toMatch(/attachment/);
    expect(res.body.eventCount).toBe(3);
    expect(res.body.events).toHaveLength(3);
  });

  it('exports only named events when names param provided', async () => {
    const { app } = createApp();

    const res = await request(app).get('/api/events/bulk/export?names=user.signed-up,order.placed');
    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(2);
    expect(res.body.events.map((e: { name: string }) => e.name)).toContain('user.signed-up');
    expect(res.body.events.map((e: { name: string }) => e.name)).toContain('order.placed');
  });

  it('includes schema and fingerprint in export', async () => {
    const { app } = createApp();

    const res = await request(app).get('/api/events/bulk/export?names=user.signed-up');
    expect(res.status).toBe(200);
    expect(res.body.events[0]).toHaveProperty('schema');
    expect(res.body.events[0]).toHaveProperty('schemaFingerprint');
    expect(res.body.events[0]).toHaveProperty('namespace');
    expect(res.body).toHaveProperty('exportedAt');
  });

  it('returns empty events array for unknown names', async () => {
    const { app } = createApp();

    const res = await request(app).get('/api/events/bulk/export?names=no.such.event');
    expect(res.status).toBe(200);
    expect(res.body.eventCount).toBe(0);
    expect(res.body.events).toHaveLength(0);
  });
});

describe('POST /api/events/bulk — invalid-schema recovery', () => {
  it('skips and logs a warn when a batch entry has an invalid schema, still registers valid ones', async () => {
    const { app, registry } = createApp();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/events/bulk')
      .send({
        serviceName: 'batch-svc',
        events: [
          { name: 'bad.schema', schema: { type: 'objct' }, transport: 'signal' },
          { name: 'good.event', schema: { type: 'object' }, transport: 'signal' },
        ],
      });

    expect(res.status).toBe(201);
    expect(registry.get('bad.schema')).toBeUndefined();
    expect(registry.get('good.event')).toBeDefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('bulk declare skipped "bad.schema"'),
      expect.any(String),
    );
    warnSpy.mockRestore();
  });
});
