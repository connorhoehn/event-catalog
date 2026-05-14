import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import { createRoutes } from '../src/server/routes.js';
import { makeHealthHandler } from '../src/server/health.js';

/**
 * End-to-end-ish wiring test: build the same app shape that
 * `startServer` builds, but with mock signal/durable transports.
 * Validates that:
 *  - GET /health returns tri-state JSON with the right top-level shape.
 *  - GET /metrics returns prom-formatted text with the declared names.
 *  - GET /api/events/:name bumps event_catalog_schema_fetches_total{event}.
 */
describe('server observability wiring (wave2-ec-5)', () => {
  let app: ReturnType<typeof express>;
  let prom: PromMetrics;
  let registry: Registry;

  beforeEach(() => {
    registry = new Registry();
    const metrics = new MetricsCollector(60);
    prom = new PromMetrics();

    const stubSignal = {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getHistory: async () => [],
    };
    const stubDurable = {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
    };
    const stubDlq = {
      list: async () => [],
      remove: async () => true,
      findById: async () => null,
      put: async () => ({ id: 'x', eventName: 'x', payload: {}, error: '', attempts: 0, deadAt: 0 }),
    };

    app = express();
    app.use(express.json());

    app.get('/health', makeHealthHandler({
      service: 'event-catalog',
      version: '0.1.1',
      checks: [
        { id: 'redis', check: async () => ({ status: 'healthy', details: { latencyMs: 1 } }) },
        { id: 'message-queue', check: async () => ({ status: 'healthy', details: { latencyMs: 1 } }) },
        { id: 'registry', check: async () => ({ status: 'healthy', details: { eventCount: registry.size() } }) },
      ],
    }));

    app.get('/metrics', (_req, res) => {
      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(prom.renderProm());
    });

    app.use('/api', createRoutes({
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as never,
      signal: stubSignal as never,
      durable: stubDurable as never,
      dlqStore: stubDlq as never,
      startedAt: Date.now(),
      promMetrics: prom,
    }));
  });

  it('GET /health returns tri-state JSON', async () => {
    const res = await request(app).get('/health').expect(200);
    expect(res.body.service).toBe('event-catalog');
    expect(res.body.status).toBe('healthy');
    expect(res.body.checks.map((c: { id: string }) => c.id).sort()).toEqual(['message-queue', 'redis', 'registry']);
    for (const c of res.body.checks) {
      expect(c.status).toBe('healthy');
    }
  });

  it('GET /metrics returns prom-formatted text', async () => {
    prom.recordPublish('foo:bar', 'signal', 'off');
    const res = await request(app).get('/metrics').expect(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('event_catalog_publish_total');
  });

  it('GET /api/events/:name records a schema_fetches_total tick', async () => {
    // Declare an event so the GET succeeds.
    registry.declare({
      name: 'svc:thing',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'svc',
    });

    await request(app).get('/api/events/svc%3Athing').expect(200);
    await request(app).get('/api/events/svc%3Athing').expect(200);

    const text = prom.renderProm();
    expect(text).toContain('event_catalog_schema_fetches_total');
    expect(text).toMatch(/event_catalog_schema_fetches_total\{[^}]*event="svc:thing"[^}]*\} 2/);
  });
});
