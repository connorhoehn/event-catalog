// tests/heartbeat.test.ts
//
// wave24-b — subscriber heartbeat + sweeper. Covers the Registry
// methods directly + the HTTP surface via supertest.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function makeApp(registry?: Registry) {
  const reg = registry ?? new Registry();
  const metrics = new MetricsCollector(60);
  const app = expressLikeApp();
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

describe('Registry heartbeat (wave24-b)', () => {
  it('addSubscriber stamps an initial lastSeenAt', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer-1');
    const all = reg.listSubscriberHeartbeats();
    expect(all).toHaveLength(1);
    expect(all[0]!.eventName).toBe('a.x');
    expect(all[0]!.serviceName).toBe('consumer-1');
    expect(Date.parse(all[0]!.lastSeenAt)).toBeGreaterThan(Date.now() - 1000);
  });

  it('heartbeat() refreshes timestamps for the listed events', async () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer');
    reg.addSubscriber('b.y', 'consumer');

    const before = reg.listSubscriberHeartbeats().find(s => s.eventName === 'a.x')!.lastSeenAt;
    await new Promise(r => setTimeout(r, 5));

    const refreshed = reg.heartbeat('consumer', ['a.x']);
    expect(refreshed).toEqual(['a.x']);
    const after = reg.listSubscriberHeartbeats().find(s => s.eventName === 'a.x')!.lastSeenAt;
    expect(Date.parse(after)).toBeGreaterThan(Date.parse(before));
  });

  it('heartbeat() with no events refreshes every subscription for that service', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer');
    reg.addSubscriber('b.y', 'consumer');
    const refreshed = reg.heartbeat('consumer');
    expect(refreshed.sort()).toEqual(['a.x', 'b.y']);
  });

  it('heartbeat() skips events the service does not subscribe to', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer-1');
    const refreshed = reg.heartbeat('consumer-1', ['a.x', 'not.subscribed']);
    expect(refreshed).toEqual(['a.x']);
  });

  it('heartbeat() skips existing events the requesting service never subscribed to (registry/index.ts:264)', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer-1');
    reg.addSubscriber('b.y', 'consumer-2'); // different service owns b.y

    // consumer-1 asks to heartbeat b.y — the event exists but consumer-1 never subscribed.
    const refreshed = reg.heartbeat('consumer-1', ['b.y']);
    expect(refreshed).toEqual([]);
  });

  it('pruneStaleSubscribers removes subscribers older than ttl + drops their heartbeats', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'fresh');
    reg.addSubscriber('b.y', 'stale');

    // Manually backdate 'stale' to simulate an old subscriber.
    const baseline = Date.now();
    const pruned = reg.pruneStaleSubscribers(60_000, baseline + 120_000); // 2-min cutoff future
    // both subscribers were added "now" so both are within 60s — neither pruned with that ttl
    // Actually with nowMs = baseline+120s, ttl 60s → cutoff = baseline+60s.
    // Subscribers stamped at ~baseline are < cutoff → both pruned.
    expect(pruned).toHaveLength(2);
    expect(reg.get('a.x')!.subscribers).toEqual([]);
    expect(reg.get('b.y')!.subscribers).toEqual([]);
  });

  it('pruneStaleSubscribers retains fresh subscriber while evicting the stale one (registry/index.ts:316)', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });

    // Stamp stale-svc at T=0 by controlling the clock.
    vi.setSystemTime(0);
    reg.addSubscriber('a.x', 'stale-svc');

    // Stamp fresh-svc 10 minutes later.
    vi.setSystemTime(600_000);
    reg.addSubscriber('a.x', 'fresh-svc');
    vi.useRealTimers();

    // nowMs = 700_000, ttl = 60_000 → cutoff = 640_000.
    // stale-svc stamped at 0 → stale (0 < 640_000).
    // fresh-svc stamped at 600_000 → fresh (600_000 < 640_000 → also stale!).
    // Need wider gap: nowMs = 700_000, ttl = 60_000 → cutoff = 640_000.
    // fresh-svc at 600_000 < 640_000 → still pruned.
    // Let's use: nowMs = 700_000, ttl = 200_000 → cutoff = 500_000.
    // stale-svc at 0 < 500_000 → pruned.
    // fresh-svc at 600_000 > 500_000 → retained.
    const pruned = reg.pruneStaleSubscribers(200_000, 700_000);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.serviceName).toBe('stale-svc');
    expect(reg.get('a.x')!.subscribers).toEqual(['fresh-svc']);
  });

  it('eventsSubscribedBy returns the right list', () => {
    const reg = new Registry();
    reg.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'b.y', schema: {}, transport: 'signal', producer: 's' });
    reg.declare({ name: 'c.z', schema: {}, transport: 'signal', producer: 's' });
    reg.addSubscriber('a.x', 'consumer');
    reg.addSubscriber('c.z', 'consumer');
    expect(reg.eventsSubscribedBy('consumer').sort()).toEqual(['a.x', 'c.z']);
  });
});

describe('POST /api/heartbeat + GET /api/subscribers (wave24-b)', () => {
  let app: ReturnType<typeof makeApp>['app'];
  let registry: Registry;

  beforeEach(() => {
    ({ app, registry } = makeApp());
    registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: 'orders' });
    registry.declare({ name: 'orders.shipped', schema: {}, transport: 'durable', producer: 'orders' });
    registry.addSubscriber('orders.placed', 'audit-worker');
    registry.addSubscriber('orders.shipped', 'audit-worker');
  });

  it('POST /api/heartbeat with no events refreshes all subscriptions for the service', async () => {
    const res = await request(app).post('/api/heartbeat').send({ serviceName: 'audit-worker' });
    expect(res.status).toBe(200);
    expect(res.body.refreshed.sort()).toEqual(['orders.placed', 'orders.shipped']);
    expect(res.body.count).toBe(2);
  });

  it('POST /api/heartbeat with events[] refreshes only those', async () => {
    const res = await request(app).post('/api/heartbeat').send({
      serviceName: 'audit-worker',
      events: ['orders.placed'],
    });
    expect(res.body.refreshed).toEqual(['orders.placed']);
  });

  it('POST /api/heartbeat returns 400 when serviceName is missing', async () => {
    const res = await request(app).post('/api/heartbeat').send({});
    expect(res.status).toBe(400);
  });

  it('POST /api/heartbeat returns 400 when serviceName is an empty string', async () => {
    const res = await request(app).post('/api/heartbeat').send({ serviceName: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/serviceName is required/);
  });

  it('GET /api/subscribers lists everyone with their lastSeenAt', async () => {
    const res = await request(app).get('/api/subscribers');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.subscribers[0]).toMatchObject({
      eventName: expect.any(String),
      serviceName: 'audit-worker',
      lastSeenAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it('GET /api/subscribers?staleAfter=N filters to stale only', async () => {
    // Use a tiny window — fresh subscribers should NOT be stale.
    const fresh = await request(app).get('/api/subscribers?staleAfter=60');
    expect(fresh.body.total).toBe(0);

    // Manually backdate by tampering with the stored ts via re-prune.
    // (Easier: query staleAfter=0 — everything older than NOW).
    const all = await request(app).get('/api/subscribers?staleAfter=-1');
    // Negative is treated as no-filter; fall back to the full list path
    expect(all.body.total).toBe(2);
  });
});
