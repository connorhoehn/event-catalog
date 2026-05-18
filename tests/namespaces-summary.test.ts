// tests/namespaces-summary.test.ts
//
// wave25-b — GET /api/namespaces/summary feeds the admin UI namespace
// browser. Verifies counts, deprecation rollup, transport split, and
// the ?detail=full drill-down payload.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function makeApp() {
  const reg = new Registry();
  const metrics = new MetricsCollector(60);
  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes({
    registry: reg,
    metrics,
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
    durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
    dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
  }));
  return { app, registry: reg };
}

describe('wave25-b — GET /api/namespaces/summary', () => {
  it('groups events by namespace and rolls up counts', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'auth.login', schema: {}, transport: 'signal', producer: 'platform-api' });
    registry.declare({ name: 'auth.logout', schema: {}, transport: 'signal', producer: 'platform-api' });
    registry.declare({ name: 'pipeline.started', schema: {}, transport: 'durable', producer: 'pipeline-worker' });
    registry.addSubscriber('auth.login', 'audit-worker');
    registry.addSubscriber('auth.logout', 'audit-worker');
    registry.addSubscriber('pipeline.started', 'pipeline-watcher');
    registry.deprecate('auth.logout', { reason: 'replaced' });

    const res = await request(app).get('/api/namespaces/summary');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);

    const auth = res.body.items.find((r: { namespace: string }) => r.namespace === 'auth')!;
    expect(auth.eventCount).toBe(2);
    expect(auth.deprecatedCount).toBe(1);
    expect(auth.producerCount).toBe(1);
    expect(auth.subscriberCount).toBe(1);
    expect(auth.signalCount).toBe(2);
    expect(auth.durableCount).toBe(0);
    expect(auth.events).toBeUndefined(); // no detail unless ?detail=full

    const pipeline = res.body.items.find((r: { namespace: string }) => r.namespace === 'pipeline')!;
    expect(pipeline.eventCount).toBe(1);
    expect(pipeline.deprecatedCount).toBe(0);
    expect(pipeline.durableCount).toBe(1);
  });

  it('?detail=full returns the per-namespace event list with deprecated flag', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 'p' });
    registry.declare({ name: 'a.y', schema: {}, transport: 'signal', producer: 'p' });
    registry.deprecate('a.y');

    const res = await request(app).get('/api/namespaces/summary?detail=full');
    expect(res.status).toBe(200);
    const a = res.body.items.find((r: { namespace: string }) => r.namespace === 'a')!;
    expect(a.events).toHaveLength(2);
    expect(a.events.find((e: { name: string }) => e.name === 'a.y').deprecated).toBe(true);
    expect(a.events.find((e: { name: string }) => e.name === 'a.x').deprecated).toBe(false);
  });

  it('handles empty registry without error', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/namespaces/summary');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.items).toEqual([]);
  });

  it("counts transport:'both' events toward signalCount AND durableCount", async () => {
    const { app, registry } = makeApp();
    // A namespace with one of each transport. The 'both' event fires on
    // signal AND durable, so it must contribute to both counts — not be
    // silently dropped by strict equality (same bug pattern as the
    // metrics-observer pollDurableStats fix).
    registry.declare({ name: 'mix.sig', schema: {}, transport: 'signal', producer: 'svc' });
    registry.declare({ name: 'mix.dur', schema: {}, transport: 'durable', producer: 'svc' });
    registry.declare({ name: 'mix.both', schema: {}, transport: 'both', producer: 'svc' });

    const res = await request(app).get('/api/namespaces/summary');
    expect(res.status).toBe(200);
    const mix = res.body.items.find((r: { namespace: string }) => r.namespace === 'mix')!;
    expect(mix.eventCount).toBe(3);
    // signal-only (1) + both (1) = 2
    expect(mix.signalCount).toBe(2);
    // durable-only (1) + both (1) = 2
    expect(mix.durableCount).toBe(2);
  });

  it('counts all producers when producer is an array (routes.ts:791 array-producer branch)', async () => {
    const { app, registry } = makeApp();
    // Two declared producers on one event — should contribute 2 to producerCount.
    registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: ['svc-a', 'svc-b'] });
    // Single-string producer on a second event in the same namespace — should not double-count 'svc-a'.
    registry.declare({ name: 'orders.cancelled', schema: {}, transport: 'durable', producer: 'svc-a' });

    const res = await request(app).get('/api/namespaces/summary');
    expect(res.status).toBe(200);
    const orders = res.body.items.find((r: { namespace: string }) => r.namespace === 'orders')!;
    expect(orders.eventCount).toBe(2);
    // 'svc-a' and 'svc-b' from orders.placed; 'svc-a' from orders.cancelled → Set deduplication → 2
    expect(orders.producerCount).toBe(2);
  });
});
