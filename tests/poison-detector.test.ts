import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { PoisonEventDetector } from '../src/server/poison-detector.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp(poisonDetector?: PoisonEventDetector) {
  const registry = new Registry();
  const metrics = new MetricsCollector(60);

  registry.declare({
    name: 'user.signed-up',
    transport: 'signal',
    producer: 'platform-api',
    schema: { type: 'object', properties: { userId: { type: 'string' } } },
  });

  const deps = {
    registry,
    metrics,
    signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] },
    durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() },
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    dlqStore: {} as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    poisonDetector,
  } as RoutesDeps;

  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(deps));
  return app;
}

describe('PoisonEventDetector', () => {
  let detector: PoisonEventDetector;

  beforeEach(() => {
    detector = new PoisonEventDetector({ windowMs: 5000, threshold: 3 });
  });

  it('is not poisoned initially', () => {
    expect(detector.isPoisoned('user.signed-up')).toBe(false);
    expect(detector.listPoisoned()).toHaveLength(0);
  });

  it('returns false before threshold is reached', () => {
    expect(detector.recordFailure('user.signed-up')).toBe(false);
    expect(detector.recordFailure('user.signed-up')).toBe(false);
    expect(detector.isPoisoned('user.signed-up')).toBe(false);
  });

  it('returns true exactly when threshold is crossed', () => {
    detector.recordFailure('user.signed-up');
    detector.recordFailure('user.signed-up');
    const became = detector.recordFailure('user.signed-up');
    expect(became).toBe(true);
    expect(detector.isPoisoned('user.signed-up')).toBe(true);
  });

  it('returns false on subsequent failures after already poisoned', () => {
    for (let i = 0; i < 3; i++) detector.recordFailure('user.signed-up');
    const again = detector.recordFailure('user.signed-up');
    expect(again).toBe(false);
  });

  it('updates failuresInWindow in poison state after further failures', () => {
    for (let i = 0; i < 3; i++) detector.recordFailure('user.signed-up');
    detector.recordFailure('user.signed-up');
    const state = detector.getPoison('user.signed-up');
    expect(state?.failuresInWindow).toBeGreaterThanOrEqual(4);
  });

  it('listPoisoned returns all poisoned events', () => {
    const d2 = new PoisonEventDetector({ windowMs: 5000, threshold: 1 });
    d2.recordFailure('a');
    d2.recordFailure('b');
    const list = d2.listPoisoned();
    expect(list.map(p => p.eventName)).toContain('a');
    expect(list.map(p => p.eventName)).toContain('b');
  });

  it('clearPoison removes the event and returns true', () => {
    for (let i = 0; i < 3; i++) detector.recordFailure('user.signed-up');
    expect(detector.clearPoison('user.signed-up')).toBe(true);
    expect(detector.isPoisoned('user.signed-up')).toBe(false);
  });

  it('clearPoison returns false for non-poisoned event', () => {
    expect(detector.clearPoison('user.signed-up')).toBe(false);
  });

  it('failureCount returns only in-window counts', () => {
    const shortDetector = new PoisonEventDetector({ windowMs: 100, threshold: 100 });
    shortDetector.recordFailure('x');
    shortDetector.recordFailure('x');
    expect(shortDetector.failureCount('x')).toBe(2);
  });

  it('uses default threshold=50 and windowMs=5min when not specified', () => {
    const d = new PoisonEventDetector();
    // Should not poison with 49 failures
    for (let i = 0; i < 49; i++) d.recordFailure('x');
    expect(d.isPoisoned('x')).toBe(false);
    const became = d.recordFailure('x');
    expect(became).toBe(true);
    expect(d.isPoisoned('x')).toBe(true);
  });
});

describe('GET /api/events/poisoned', () => {
  it('returns empty list when no events are poisoned', async () => {
    const detector = new PoisonEventDetector({ threshold: 3, windowMs: 5000 });
    const app = createApp(detector);

    const res = await request(app).get('/api/events/poisoned');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });

  it('returns poisoned events', async () => {
    const detector = new PoisonEventDetector({ threshold: 2, windowMs: 5000 });
    detector.recordFailure('user.signed-up');
    detector.recordFailure('user.signed-up');
    const app = createApp(detector);

    const res = await request(app).get('/api/events/poisoned');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0].eventName).toBe('user.signed-up');
    expect(res.body.items[0].failuresInWindow).toBeGreaterThanOrEqual(2);
  });

  it('returns empty list when no detector wired', async () => {
    const app = createApp(undefined);
    const res = await request(app).get('/api/events/poisoned');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(0);
  });
});

describe('DELETE /api/events/:name/poison', () => {
  it('clears poison state and returns wasPoison=true', async () => {
    const detector = new PoisonEventDetector({ threshold: 1, windowMs: 5000 });
    detector.recordFailure('user.signed-up');
    const app = createApp(detector);

    const res = await request(app).delete('/api/events/user.signed-up/poison');
    expect(res.status).toBe(200);
    expect(res.body.wasPoison).toBe(true);
    expect(detector.isPoisoned('user.signed-up')).toBe(false);
  });

  it('returns wasPoison=false when event was not poisoned', async () => {
    const detector = new PoisonEventDetector({ threshold: 100, windowMs: 5000 });
    const app = createApp(detector);

    const res = await request(app).delete('/api/events/user.signed-up/poison');
    expect(res.status).toBe(200);
    expect(res.body.wasPoison).toBe(false);
  });
});
