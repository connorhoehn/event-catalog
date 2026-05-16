import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { ProducerAttributionStore } from '../src/server/producer-attribution.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createMockSignal() {
  return {
    isConnected: () => true,
    healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
    getAllMetrics: () => new Map(),
    getHistory: async () => [],
  };
}

function createMockDurable() {
  return {
    isConnected: () => true,
    healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
    getAllMetrics: () => new Map(),
  };
}

function createApp(attribution?: ProducerAttributionStore) {
  const registry = new Registry();
  const metrics = new MetricsCollector(60);
  const signal = createMockSignal();
  const durable = createMockDurable();

  registry.declare({
    name: 'user.signed-up',
    transport: 'signal',
    producer: 'platform-api',
    schema: { type: 'object', properties: { userId: { type: 'string' } } },
  });

  const deps = {
    registry,
    metrics,
    signal,
    durable,
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    dlqStore: {} as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    attribution,
  } as RoutesDeps;

  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(deps));
  return { app, registry };
}

describe('ProducerAttributionStore', () => {
  let store: ProducerAttributionStore;

  beforeEach(() => {
    store = new ProducerAttributionStore();
  });

  it('records and retrieves observed producers', () => {
    store.record('user.signed-up', 'platform-api');
    store.record('user.signed-up', 'legacy-auth');
    expect(store.getObserved('user.signed-up')).toContain('platform-api');
    expect(store.getObserved('user.signed-up')).toContain('legacy-auth');
  });

  it('deduplicates repeated recordings', () => {
    store.record('user.signed-up', 'platform-api');
    store.record('user.signed-up', 'platform-api');
    expect(store.getObserved('user.signed-up')).toHaveLength(1);
  });

  it('returns empty array for unknown event', () => {
    expect(store.getObserved('no.such.event')).toHaveLength(0);
  });

  it('getAll returns all events with their producers', () => {
    store.record('a', 'svc1');
    store.record('b', 'svc2');
    const all = store.getAll();
    expect(all['a']).toContain('svc1');
    expect(all['b']).toContain('svc2');
  });

  it('clear empties all state', () => {
    store.record('user.signed-up', 'platform-api');
    store.clear();
    expect(store.getObserved('user.signed-up')).toHaveLength(0);
  });
});

describe('GET /api/events/:name/producers/observed', () => {
  it('returns declared and observed when attribution store present', async () => {
    const attribution = new ProducerAttributionStore();
    attribution.record('user.signed-up', 'platform-api');
    attribution.record('user.signed-up', 'rogue-service');
    const { app } = createApp(attribution);

    const res = await request(app).get('/api/events/user.signed-up/producers/observed');
    expect(res.status).toBe(200);
    expect(res.body.declared).toEqual(['platform-api']);
    expect(res.body.observed).toContain('platform-api');
    expect(res.body.observed).toContain('rogue-service');
    expect(res.body.undeclaredProducers).toContain('rogue-service');
    expect(res.body.deadDeclaredProducers).toHaveLength(0);
    expect(res.body.mismatch).toBe(true);
  });

  it('detects dead declared producers (declared but never observed)', async () => {
    const attribution = new ProducerAttributionStore();
    // No observations recorded — platform-api declared but never seen publishing
    const { app } = createApp(attribution);

    const res = await request(app).get('/api/events/user.signed-up/producers/observed');
    expect(res.status).toBe(200);
    expect(res.body.declared).toEqual(['platform-api']);
    expect(res.body.observed).toHaveLength(0);
    expect(res.body.deadDeclaredProducers).toContain('platform-api');
    expect(res.body.mismatch).toBe(true);
  });

  it('returns no mismatch when observed matches declared exactly', async () => {
    const attribution = new ProducerAttributionStore();
    attribution.record('user.signed-up', 'platform-api');
    const { app } = createApp(attribution);

    const res = await request(app).get('/api/events/user.signed-up/producers/observed');
    expect(res.status).toBe(200);
    expect(res.body.mismatch).toBe(false);
    expect(res.body.undeclaredProducers).toHaveLength(0);
    expect(res.body.deadDeclaredProducers).toHaveLength(0);
  });

  it('returns empty observed when no attribution store wired', async () => {
    const { app } = createApp(undefined);

    const res = await request(app).get('/api/events/user.signed-up/producers/observed');
    expect(res.status).toBe(200);
    expect(res.body.observed).toHaveLength(0);
  });

  it('returns 404 for unknown events', async () => {
    const attribution = new ProducerAttributionStore();
    const { app } = createApp(attribution);

    const res = await request(app).get('/api/events/no.such.event/producers/observed');
    expect(res.status).toBe(404);
  });
});
