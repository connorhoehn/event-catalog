import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { PromMetrics } from '../src/server/prom-metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

/**
 * Mock SignalTransport — satisfies the interface used by routes
 */
function createMockSignal() {
  const channelMetrics = new Map<string, { publishCount: number; lastPublishedAt: string | null; subscriberCount: number }>();
  const historyStore = new Map<string, Array<Record<string, unknown>>>();

  return {
    isConnected: () => true,
    healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
    getAllMetrics: () => new Map(channelMetrics),
    getHistory: async (channel: string, count = 50) => {
      return (historyStore.get(channel) ?? []).slice(-count);
    },
    _setChannelMetrics(channel: string, metrics: { publishCount: number; lastPublishedAt: string | null; subscriberCount: number }) {
      channelMetrics.set(channel, metrics);
    },
    _setHistory(channel: string, messages: Array<Record<string, unknown>>) {
      historyStore.set(channel, messages);
    },
  };
}

/**
 * Mock DurableTransport — satisfies the interface used by routes
 */
function createMockDurable() {
  const queueMetrics = new Map<string, { sent: number; received: number; failed: number; inFlight: number }>();

  return {
    isConnected: () => true,
    healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
    getAllMetrics: () => new Map(queueMetrics),
    _setQueueMetrics(queue: string, metrics: { sent: number; received: number; failed: number; inFlight: number }) {
      queueMetrics.set(queue, metrics);
    },
  };
}

function createApp(deps: RoutesDeps) {
  const app = express();
  app.use(express.json());
  app.use('/api', createRoutes(deps));
  return app;
}

describe('Server Routes', () => {
  let registry: Registry;
  let metrics: MetricsCollector;
  let signal: ReturnType<typeof createMockSignal>;
  let durable: ReturnType<typeof createMockDurable>;
  let app: ReturnType<typeof express>;

  beforeEach(() => {
    registry = new Registry();
    metrics = new MetricsCollector(60);
    signal = createMockSignal();
    durable = createMockDurable();

    app = createApp({
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: signal as unknown as RoutesDeps['signal'],
      durable: durable as unknown as RoutesDeps['durable'],
      startedAt: Date.now(),
    });
  });

  // ─── GET /api/events ─────────────────────────────────────────────────

  describe('GET /api/events', () => {
    it('returns an empty list when no events are declared', async () => {
      const res = await request(app).get('/api/events');
      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
      expect(res.body.total).toBe(0);
    });

    it('returns all declared events', async () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });

      const res = await request(app).get('/api/events');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.total).toBe(2);
    });

    it('filters by transport=signal', async () => {
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });
      registry.declare({ name: 'pipeline:done', schema: {}, transport: 'durable', producer: 'pipeline' });

      const res = await request(app).get('/api/events?transport=signal');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(1);
      expect(res.body.events[0].name).toBe('cursor:move');
    });

    it('filters by producer', async () => {
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });
      registry.declare({ name: 'pipeline:done', schema: {}, transport: 'durable', producer: 'platform-api' });
      registry.declare({ name: 'ingest:start', schema: {}, transport: 'durable', producer: 'platform-api' });

      const res = await request(app).get('/api/events?producer=platform-api');
      expect(res.status).toBe(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.events.every((e: { producer: string }) => e.producer === 'platform-api')).toBe(true);
    });
  });

  // ─── GET /api/events/:name ───────────────────────────────────────────

  describe('GET /api/events/:name', () => {
    it('returns a single event by name', async () => {
      registry.declare({ name: 'user:created', schema: { type: 'object' }, transport: 'durable', producer: 'auth' });

      const res = await request(app).get('/api/events/user:created');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('user:created');
      expect(res.body.transport).toBe('durable');
      expect(res.body.producer).toBe('auth');
    });

    it('returns 404 for non-existent event', async () => {
      const res = await request(app).get('/api/events/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── GET /api/events/:name schema-fetch contract (wave3-ec-6) ────────
  //
  // Same route as the admin endpoint above, but exercised against the
  // downstream-validator contract: response carries
  // `{ name, version, schema, validationMode, producer, transport }`,
  // supports `?version=N`, and ticks the schema_fetches_total counter
  // when promMetrics is wired.

  describe('GET /api/events/:name schema-fetch (wave3-ec-6)', () => {
    let prom: PromMetrics;
    let appWithProm: ReturnType<typeof express>;

    beforeEach(() => {
      prom = new PromMetrics();
      appWithProm = createApp({
        registry,
        metrics,
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: signal as unknown as RoutesDeps['signal'],
        durable: durable as unknown as RoutesDeps['durable'],
        dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
        startedAt: Date.now(),
        promMetrics: prom,
      });
    });

    it('returns 200 with name/version/schema/validationMode/producer/transport', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
        transport: 'durable',
        producer: 'platform-api',
      });

      const res = await request(appWithProm).get('/api/events/activity:recorded');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('activity:recorded');
      expect(res.body.version).toBe(1);
      expect(res.body.schema).toEqual({ type: 'object', properties: { userId: { type: 'string' } } });
      expect(res.body.validationMode).toBe('off');
      expect(res.body.producer).toBe('platform-api');
      expect(res.body.transport).toBe('durable');
    });

    it('?version=N returns the historical schema for that version', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object', properties: { userId: { type: 'string' } } },
        transport: 'durable',
        producer: 'platform-api',
        compatibilityMode: 'none', // allow arbitrary schema changes
      });
      // Bump version with a new schema; previous goes into history.
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object', properties: { userId: { type: 'string' }, action: { type: 'string' } } },
        transport: 'durable',
        producer: 'platform-api',
        compatibilityMode: 'none',
      });

      const latest = await request(appWithProm).get('/api/events/activity:recorded');
      expect(latest.status).toBe(200);
      expect(latest.body.version).toBe(2);
      expect((latest.body.schema as { properties: Record<string, unknown> }).properties.action).toBeDefined();

      const v1 = await request(appWithProm).get('/api/events/activity:recorded').query({ version: '1' });
      expect(v1.status).toBe(200);
      expect(v1.body.version).toBe(1);
      expect((v1.body.schema as { properties: Record<string, unknown> }).properties.action).toBeUndefined();
      expect(v1.body.producer).toBe('platform-api');
    });

    it('returns 404 when event is undeclared', async () => {
      const res = await request(appWithProm).get('/api/events/never:declared');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('returns 400 when version query is malformed', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'platform-api',
      });

      const nan = await request(appWithProm).get('/api/events/activity:recorded').query({ version: 'abc' });
      expect(nan.status).toBe(400);
      expect(nan.body.error).toContain('positive integer');

      const zero = await request(appWithProm).get('/api/events/activity:recorded').query({ version: '0' });
      expect(zero.status).toBe(400);

      const neg = await request(appWithProm).get('/api/events/activity:recorded').query({ version: '-1' });
      expect(neg.status).toBe(400);
    });

    it('returns 404 when version is well-formed but absent from history', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'platform-api',
      });

      const res = await request(appWithProm).get('/api/events/activity:recorded').query({ version: '99' });
      expect(res.status).toBe(404);
      expect(res.body.error).toMatch(/Version 99 not found in history/);
    });

    it('?version=N equal to current version skips history lookup and returns 200 (routes.ts:135)', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object', properties: { id: { type: 'string' } } },
        transport: 'durable',
        producer: 'platform-api',
      });
      // Event is still at v1 — never bumped; no schemaHistory entries.
      const res = await request(appWithProm)
        .get('/api/events/activity:recorded')
        .query({ version: '1' });
      expect(res.status).toBe(200);
      expect(res.body.version).toBe(1);
      expect((res.body.schema as { properties: Record<string, unknown> }).properties.id).toBeDefined();
    });

    it('ticks event_catalog_schema_fetches_total on each successful fetch', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'platform-api',
      });

      await request(appWithProm).get('/api/events/activity:recorded').expect(200);
      await request(appWithProm).get('/api/events/activity:recorded').expect(200);
      await request(appWithProm).get('/api/events/activity:recorded').expect(200);

      const text = prom.renderProm();
      expect(text).toContain('event_catalog_schema_fetches_total');
      expect(text).toMatch(/event_catalog_schema_fetches_total\{[^}]*event="activity:recorded"[^}]*\} 3/);
    });

    it('does NOT tick the counter when ?version is malformed (400)', async () => {
      registry.declare({
        name: 'activity:recorded',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'platform-api',
      });

      await request(appWithProm).get('/api/events/activity:recorded').query({ version: 'bad' }).expect(400);

      const text = prom.renderProm();
      // No event= sample for this event yet.
      expect(text).not.toMatch(/event_catalog_schema_fetches_total\{[^}]*event="activity:recorded"/);
    });
  });

  // ─── POST /api/events ────────────────────────────────────────────────

  describe('POST /api/events', () => {
    it('declares a new event and returns 201', async () => {
      const res = await request(app)
        .post('/api/events')
        .send({ name: 'user:created', transport: 'durable', producer: 'auth', schema: { type: 'object' } });

      expect(res.status).toBe(201);
      expect(res.body.declared).toBe('user:created');
      expect(registry.get('user:created')).toBeDefined();
    });

    it('returns 400 when required fields are missing', async () => {
      const res = await request(app)
        .post('/api/events')
        .send({ name: 'user:created' }); // missing transport and producer

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('required');
    });

    it('returns 400 when transport is invalid', async () => {
      const res = await request(app)
        .post('/api/events')
        .send({ name: 'test:event', transport: 'invalid', producer: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('transport');
    });

    it('returns 400 when schema shape is invalid (e.g. unknown type)', async () => {
      const res = await request(app)
        .post('/api/events')
        .send({ name: 'bad:schema', transport: 'signal', producer: 'test', schema: { type: 'objct' } });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('invalid JSON Schema shape');
    });
  });

  // ─── DELETE /api/events/:name ────────────────────────────────────────

  describe('DELETE /api/events/:name', () => {
    it('removes an existing event', async () => {
      registry.declare({ name: 'temp:event', schema: {}, transport: 'signal', producer: 'test' });

      const res = await request(app).delete('/api/events/temp:event');
      expect(res.status).toBe(200);
      expect(res.body.removed).toBe('temp:event');
      expect(registry.get('temp:event')).toBeUndefined();
    });

    it('returns 404 for non-existent event', async () => {
      const res = await request(app).delete('/api/events/nonexistent');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── POST /api/events/bulk ───────────────────────────────────────────

  describe('POST /api/events/bulk', () => {
    it('registers multiple events at once', async () => {
      const res = await request(app)
        .post('/api/events/bulk')
        .send({
          serviceName: 'platform-api',
          events: [
            { name: 'pipeline:started', transport: 'durable', schema: {} },
            { name: 'pipeline:completed', transport: 'durable', schema: {} },
            { name: 'cursor:move', transport: 'signal', schema: {} },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.declared).toHaveLength(3);
      expect(res.body.count).toBe(3);
      expect(registry.get('pipeline:started')!.producer).toBe('platform-api');
    });

    it('returns 400 when serviceName is missing', async () => {
      const res = await request(app)
        .post('/api/events/bulk')
        .send({ events: [{ name: 'x', transport: 'signal' }] });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('serviceName');
    });

    it('returns 400 when events array is missing', async () => {
      const res = await request(app)
        .post('/api/events/bulk')
        .send({ serviceName: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('events[]');
    });

    it('skips events without required fields', async () => {
      const res = await request(app)
        .post('/api/events/bulk')
        .send({
          serviceName: 'platform-api',
          events: [
            { name: 'valid:event', transport: 'signal', schema: {} },
            { transport: 'durable' }, // missing name
            { name: 'no-transport' }, // missing transport
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.declared).toHaveLength(1);
      expect(res.body.declared[0]).toBe('valid:event');
    });

    it('skips events with invalid schema shape without crashing the batch', async () => {
      const res = await request(app)
        .post('/api/events/bulk')
        .send({
          serviceName: 'platform-api',
          events: [
            { name: 'good:event', transport: 'signal', schema: { type: 'object' } },
            { name: 'bad:schema', transport: 'signal', schema: { type: 'objct' } },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.declared).toContain('good:event');
      expect(res.body.declared).not.toContain('bad:schema');
    });
  });

  // ─── GET /api/events/:name/stats ─────────────────────────────────────

  describe('GET /api/events/:name/stats', () => {
    it('returns event stats when they exist', async () => {
      // Recording a publish creates stats
      metrics.recordPublish('user:created');

      const res = await request(app).get('/api/events/user:created/stats');
      expect(res.status).toBe(200);
      expect(res.body.publishCount).toBe(1);
      expect(res.body.lastPublishedAt).toBeDefined();
    });

    it('returns 404 when no stats exist for event', async () => {
      const res = await request(app).get('/api/events/nonexistent/stats');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('No stats');
    });
  });

  // ─── GET /api/events/:name/history ───────────────────────────────────

  describe('GET /api/events/:name/history', () => {
    it('returns history for a signal event', async () => {
      registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor' });
      signal._setHistory('cursor:move', [
        { id: '1', name: 'cursor:move', payload: { x: 10 } },
        { id: '2', name: 'cursor:move', payload: { x: 20 } },
      ]);

      const res = await request(app).get('/api/events/cursor:move/history');
      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(2);
      expect(res.body.transport).toBe('signal');
    });

    it('returns empty array with note for durable event', async () => {
      registry.declare({ name: 'pipeline:done', schema: {}, transport: 'durable', producer: 'pipeline' });

      const res = await request(app).get('/api/events/pipeline:done/history');
      expect(res.status).toBe(200);
      expect(res.body.messages).toEqual([]);
      expect(res.body.transport).toBe('durable');
      expect(res.body.note).toContain('not yet implemented');
    });

    it('returns 404 for non-existent event', async () => {
      const res = await request(app).get('/api/events/nonexistent/history');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── GET /api/topology ───────────────────────────────────────────────

  describe('GET /api/topology', () => {
    it('returns nodes and edges', async () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth-service' });
      registry.addSubscriber('user:created', 'notification-service');

      const res = await request(app).get('/api/topology');
      expect(res.status).toBe(200);
      expect(res.body.nodes).toBeDefined();
      expect(res.body.edges).toBeDefined();
      // auth-service (service) + user:created (event) + notification-service (service) = 3 nodes
      expect(res.body.nodes).toHaveLength(3);
      // auth-service→user:created (publishes) + user:created→notification-service (subscribes) = 2 edges
      expect(res.body.edges).toHaveLength(2);
    });

    it('returns empty topology when no events exist', async () => {
      const res = await request(app).get('/api/topology');
      expect(res.status).toBe(200);
      expect(res.body.nodes).toEqual([]);
      expect(res.body.edges).toEqual([]);
    });

    // ─── Phase E4.3 — query-param filtering ─────────────────────────────
    describe('filtering via query params (Phase E4.3)', () => {
      beforeEach(() => {
        registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth-service' });
        registry.declare({ name: 'cursor:move', schema: {}, transport: 'signal', producer: 'editor-service' });
        registry.addSubscriber('user:created', 'notification-service');
        registry.addSubscriber('cursor:move', 'collab-service');
      });

      it('?producer=auth-service narrows to that service\'s events', async () => {
        const res = await request(app).get('/api/topology').query({ producer: 'auth-service' });
        expect(res.status).toBe(200);
        const eventNames = res.body.nodes
          .filter((n: { type: string }) => n.type === 'event')
          .map((n: { id: string }) => n.id);
        expect(eventNames).toEqual(['user:created']);
      });

      it('?consumer=collab-service narrows to events that service subscribes to', async () => {
        const res = await request(app).get('/api/topology').query({ consumer: 'collab-service' });
        expect(res.status).toBe(200);
        const eventNames = res.body.nodes
          .filter((n: { type: string }) => n.type === 'event')
          .map((n: { id: string }) => n.id);
        expect(eventNames).toEqual(['cursor:move']);
      });

      it('?eventType=user:created returns exactly that event subgraph', async () => {
        const res = await request(app).get('/api/topology').query({ eventType: 'user:created' });
        expect(res.status).toBe(200);
        const eventNames = res.body.nodes
          .filter((n: { type: string }) => n.type === 'event')
          .map((n: { id: string }) => n.id);
        expect(eventNames).toEqual(['user:created']);
      });

      it('?transport=signal partitions by transport', async () => {
        const res = await request(app).get('/api/topology').query({ transport: 'signal' });
        expect(res.status).toBe(200);
        const eventNames = res.body.nodes
          .filter((n: { type: string }) => n.type === 'event')
          .map((n: { id: string }) => n.id);
        expect(eventNames).toEqual(['cursor:move']);
      });

      it('combined filters AND-narrow the result', async () => {
        const res = await request(app)
          .get('/api/topology')
          .query({ producer: 'auth-service', consumer: 'notification-service' });
        expect(res.status).toBe(200);
        const eventNames = res.body.nodes
          .filter((n: { type: string }) => n.type === 'event')
          .map((n: { id: string }) => n.id);
        expect(eventNames).toEqual(['user:created']);
      });

      it('ignores unrelated query params and returns full topology', async () => {
        const res = await request(app).get('/api/topology').query({ foo: 'bar' });
        expect(res.status).toBe(200);
        const eventNodes = res.body.nodes.filter((n: { type: string }) => n.type === 'event');
        expect(eventNodes).toHaveLength(2);
      });
    });
  });

  // ─── GET /api/health ─────────────────────────────────────────────────

  describe('GET /api/health', () => {
    it('returns health status with redis and messageQueue state', async () => {
      registry.declare({ name: 'ev1', schema: {}, transport: 'signal', producer: 'test' });

      const res = await request(app).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(res.body.redis.status).toBe('connected');
      expect(res.body.messageQueue.status).toBe('connected');
      expect(res.body.uptime).toBeGreaterThanOrEqual(0);
      expect(res.body.eventCount).toBe(1);
    });

    it('reports degraded state (HTTP 200) when one transport is degraded', async () => {
      const degradedSignal = { ...signal, healthCheck: async () => ({ status: 'degraded' as const, latencyMs: 800 }) };

      const degradedApp = createApp({
        registry,
        metrics,
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: degradedSignal as unknown as RoutesDeps['signal'],
        durable: durable as unknown as RoutesDeps['durable'],
        startedAt: Date.now(),
      });

      const res = await request(degradedApp).get('/api/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('degraded');
    });

    it('reports disconnected state when transports are down', async () => {
      const disconnectedSignal = { ...signal, healthCheck: async () => ({ status: 'disconnected' as const, latencyMs: -1 }) };
      const disconnectedDurable = { ...durable, healthCheck: async () => ({ status: 'disconnected' as const, latencyMs: -1 }) };

      const disconnectedApp = createApp({
        registry,
        metrics,
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: disconnectedSignal as unknown as RoutesDeps['signal'],
        durable: disconnectedDurable as unknown as RoutesDeps['durable'],
        startedAt: Date.now(),
      });

      const res = await request(disconnectedApp).get('/api/health');
      expect(res.status).toBe(503);
      expect(res.body.redis.status).toBe('disconnected');
      expect(res.body.messageQueue.status).toBe('disconnected');
    });
  });

  // ─── GET /api/metrics ────────────────────────────────────────────────

  describe('GET /api/metrics', () => {
    it('returns metrics snapshot', async () => {
      metrics.recordPublish('user:created');
      metrics.recordPublish('user:created');
      metrics.recordError('user:created');

      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body['user:created']).toBeDefined();
      expect(res.body['user:created'].publishCount).toBe(2);
      expect(res.body['user:created'].errorCount).toBe(1);
    });

    it('returns empty object when no metrics exist', async () => {
      const res = await request(app).get('/api/metrics');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });
  });

  // ─── GET /api/transports/signal/channels ─────────────────────────────

  describe('GET /api/transports/signal/channels', () => {
    it('returns channel list with metrics', async () => {
      signal._setChannelMetrics('cursor:move', { publishCount: 42, lastPublishedAt: '2026-01-01T00:00:00.000Z', subscriberCount: 3 });
      signal._setChannelMetrics('presence:join', { publishCount: 10, lastPublishedAt: null, subscriberCount: 1 });

      const res = await request(app).get('/api/transports/signal/channels');
      expect(res.status).toBe(200);
      expect(res.body.channels).toHaveLength(2);
      expect(res.body.total).toBe(2);

      const cursor = res.body.channels.find((c: { channel: string }) => c.channel === 'cursor:move');
      expect(cursor).toBeDefined();
      expect(cursor.publishCount).toBe(42);
      expect(cursor.subscriberCount).toBe(3);
    });

    it('returns empty list when no channels exist', async () => {
      const res = await request(app).get('/api/transports/signal/channels');
      expect(res.status).toBe(200);
      expect(res.body.channels).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  // ─── GET /api/transports/durable/queues ──────────────────────────────

  describe('GET /api/transports/durable/queues', () => {
    it('returns queue list with metrics', async () => {
      durable._setQueueMetrics('user-created', { sent: 100, received: 95, failed: 5, inFlight: 2 });

      const res = await request(app).get('/api/transports/durable/queues');
      expect(res.status).toBe(200);
      expect(res.body.queues).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.queues[0].queue).toBe('user-created');
      expect(res.body.queues[0].sent).toBe(100);
      expect(res.body.queues[0].failed).toBe(5);
    });

    it('returns empty list when no queues exist', async () => {
      const res = await request(app).get('/api/transports/durable/queues');
      expect(res.status).toBe(200);
      expect(res.body.queues).toEqual([]);
      expect(res.body.total).toBe(0);
    });
  });

  // ─── POST /api/events/:name/subscribers ──────────────────────────────

  describe('POST /api/events/:name/subscribers', () => {
    it('registers a subscriber for an existing event', async () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });

      const res = await request(app)
        .post('/api/events/user:created/subscribers')
        .send({ serviceName: 'notification-service' });

      expect(res.status).toBe(201);
      expect(res.body.event).toBe('user:created');
      expect(res.body.subscriber).toBe('notification-service');
      expect(registry.get('user:created')!.subscribers).toContain('notification-service');
    });

    it('returns 400 when serviceName is missing', async () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });

      const res = await request(app)
        .post('/api/events/user:created/subscribers')
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('serviceName');
    });

    it('returns 404 when event does not exist', async () => {
      const res = await request(app)
        .post('/api/events/nonexistent/subscribers')
        .send({ serviceName: 'test' });

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── DELETE /api/events/:name/subscribers/:serviceName ────────────────

  describe('DELETE /api/events/:name/subscribers/:serviceName', () => {
    it('removes a subscriber from an event', async () => {
      registry.declare({ name: 'user:created', schema: {}, transport: 'durable', producer: 'auth' });
      registry.addSubscriber('user:created', 'notification-service');

      const res = await request(app).delete('/api/events/user:created/subscribers/notification-service');
      expect(res.status).toBe(200);
      expect(res.body.event).toBe('user:created');
      expect(res.body.removedSubscriber).toBe('notification-service');
      expect(registry.get('user:created')!.subscribers).not.toContain('notification-service');
    });

    it('returns 404 when event does not exist', async () => {
      const res = await request(app).delete('/api/events/nonexistent/subscribers/some-service');
      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });
  });

  // ─── Audit emit on registry mutations (wave22-d) ─────────────────────

  describe('audit emission via routes', () => {
    let seen: import('../src/server/audit-emitter.js').AuditEvent[];
    let off: () => void;
    beforeEach(async () => {
      const { auditEmitter } = await import('../src/server/audit-emitter.js');
      auditEmitter.removeAllListeners('audit');
      seen = [];
      const handler = (e: import('../src/server/audit-emitter.js').AuditEvent) => {
        seen.push(e);
      };
      auditEmitter.on('audit', handler);
      off = () => auditEmitter.off('audit', handler);
    });
    afterEach(() => off());

    it('POST /api/events emits event.declared on first registration', async () => {
      await request(app).post('/api/events').send({
        name: 'orders.created', schema: { type: 'object' }, transport: 'durable', producer: 'orders',
      });
      const declared = seen.filter((e) => e.kind === 'event.declared');
      expect(declared).toHaveLength(1);
      expect(declared[0]!.eventName).toBe('orders.created');
      expect(declared[0]!.namespace).toBe('orders');
      expect(declared[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    });

    it('POST /api/events on existing event with new schema emits event.version.bumped', async () => {
      await request(app).post('/api/events').send({
        name: 'orders.created', schema: { type: 'object' }, transport: 'durable', producer: 'orders',
        compatibilityMode: 'none',
      });
      seen.length = 0;

      await request(app).post('/api/events').send({
        name: 'orders.created', schema: { type: 'object', properties: { id: { type: 'string' } } },
        transport: 'durable', producer: 'orders', compatibilityMode: 'none',
      });
      const bumps = seen.filter((e) => e.kind === 'event.version.bumped');
      expect(bumps).toHaveLength(1);
      expect(bumps[0]!.version).toBe(2);
    });

    it('event.version.bumped carries violations[] when compat-break accepted in warn mode', async () => {
      // v1: requires field "id"
      await request(app).post('/api/events').send({
        name: 'compat.warn.evt',
        schema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
        transport: 'signal',
        producer: 'svc',
      });
      seen.length = 0;
      delete process.env.EVENT_CATALOG_STRICT;

      // v2: adds a new required field "name" — backward-incompatible
      const res = await request(app).post('/api/events').send({
        name: 'compat.warn.evt',
        schema: {
          type: 'object',
          properties: { id: { type: 'string' }, name: { type: 'string' } },
          required: ['id', 'name'],
        },
        transport: 'signal',
        producer: 'svc',
      });

      expect(res.status).toBe(201);
      expect(Array.isArray(res.body.violations)).toBe(true);
      expect(res.body.violations.length).toBeGreaterThan(0);

      const bumps = seen.filter((e) => e.kind === 'event.version.bumped');
      expect(bumps).toHaveLength(1);
      expect(bumps[0]!.version).toBe(2);
      expect(Array.isArray(bumps[0]!.violations)).toBe(true);
      expect(bumps[0]!.violations!.length).toBeGreaterThan(0);
    });

    it('POST /api/events/:name/subscribers emits subscriber.added', async () => {
      registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
      seen.length = 0;
      await request(app).post('/api/events/a.x/subscribers').send({ serviceName: 'consumer-1' });
      const added = seen.filter((e) => e.kind === 'subscriber.added');
      expect(added).toHaveLength(1);
      expect(added[0]!.serviceName).toBe('consumer-1');
    });

    it('DELETE /api/events/:name emits event.removed', async () => {
      registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
      seen.length = 0;
      await request(app).delete('/api/events/a.x');
      const removed = seen.filter((e) => e.kind === 'event.removed');
      expect(removed).toHaveLength(1);
      expect(removed[0]!.eventName).toBe('a.x');
    });

    it('DELETE /api/events/:name/subscribers/:serviceName emits subscriber.removed', async () => {
      registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
      registry.addSubscriber('a.x', 'consumer-1');
      seen.length = 0;
      await request(app).delete('/api/events/a.x/subscribers/consumer-1');
      const removed = seen.filter((e) => e.kind === 'subscriber.removed');
      expect(removed).toHaveLength(1);
      expect(removed[0]!.eventName).toBe('a.x');
      expect(removed[0]!.serviceName).toBe('consumer-1');
    });

    it('DELETE /api/events/:name/deprecate emits event.undeprecated', async () => {
      registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
      registry.deprecate('a.x', { reason: 'old' });
      seen.length = 0;
      await request(app).delete('/api/events/a.x/deprecate');
      const undeprecated = seen.filter((e) => e.kind === 'event.undeprecated');
      expect(undeprecated).toHaveLength(1);
      expect(undeprecated[0]!.eventName).toBe('a.x');
    });
  });

  // ─── GET /api/fingerprints (wave21-e) ────────────────────────────────

  describe('GET /api/fingerprints', () => {
    it('returns a flat {eventName: fingerprint} manifest of every declared event', async () => {
      registry.declare({ name: 'pipeline.run.started', schema: { type: 'object' }, transport: 'signal', producer: 'dc' });
      registry.declare({ name: 'sfu.stream.started', schema: { type: 'object' }, transport: 'durable', producer: 'sfu' });

      const res = await request(app).get('/api/fingerprints');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['pipeline.run.started', 'sfu.stream.started']);
      // Fingerprints are 64-char lowercase hex.
      expect(res.body['pipeline.run.started']).toMatch(/^[0-9a-f]{64}$/);
      expect(res.body['sfu.stream.started']).toMatch(/^[0-9a-f]{64}$/);
    });

    it('?namespace=X filters the manifest', async () => {
      registry.declare({ name: 'pipeline.a', schema: {}, transport: 'signal', producer: 'dc' });
      registry.declare({ name: 'pipeline.b', schema: {}, transport: 'signal', producer: 'dc' });
      registry.declare({ name: 'sfu.x', schema: {}, transport: 'signal', producer: 'sfu' });

      const res = await request(app).get('/api/fingerprints?namespace=pipeline');
      expect(res.status).toBe(200);
      expect(Object.keys(res.body).sort()).toEqual(['pipeline.a', 'pipeline.b']);
    });

    it('returns an empty object when no events match', async () => {
      const res = await request(app).get('/api/fingerprints?namespace=does-not-exist');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({});
    });

    it('shape-stable: same schema → same fingerprint regardless of declaration order', async () => {
      registry.declare({ name: 'a.b', schema: { type: 'object', required: ['x', 'y'] }, transport: 'signal', producer: 's' });
      const r1 = await request(app).get('/api/fingerprints');

      registry.declare({ name: 'a.b', schema: { required: ['x', 'y'], type: 'object' }, transport: 'signal', producer: 's' });
      const r2 = await request(app).get('/api/fingerprints');

      expect(r1.body['a.b']).toBe(r2.body['a.b']);
    });
  });

  // ─── POST /api/freshness (wave21-g) ──────────────────────────────────

  describe('POST /api/freshness', () => {
    it('reports fresh / stale / unknown per supplied event', async () => {
      registry.declare({ name: 'pipeline.run.started', schema: { type: 'object' }, transport: 'signal', producer: 'dc' });
      registry.declare({ name: 'sfu.stream.started', schema: { type: 'object' }, transport: 'signal', producer: 'sfu' });
      const localFresh = registry.get('pipeline.run.started')!.schemaFingerprint;

      const res = await request(app).post('/api/freshness').send({
        events: [
          { name: 'pipeline.run.started', fingerprint: localFresh },                     // fresh
          { name: 'sfu.stream.started', fingerprint: 'feedface'.padEnd(64, '0') },       // stale
          { name: 'unknown.event', fingerprint: 'aaaa'.padEnd(64, '0') },                // unknown
        ],
      });

      expect(res.status).toBe(200);
      const byName = Object.fromEntries(res.body.reports.map((r: { name: string }) => [r.name, r]));
      expect(byName['pipeline.run.started'].status).toBe('fresh');
      expect(byName['pipeline.run.started'].remoteFingerprint).toBe(localFresh);
      expect(byName['sfu.stream.started'].status).toBe('stale');
      expect(byName['sfu.stream.started'].remoteFingerprint).not.toBe('feedface'.padEnd(64, '0'));
      expect(byName['unknown.event'].status).toBe('unknown');
      expect(byName['unknown.event'].remoteFingerprint).toBeNull();
    });

    it('marks malformed entries `invalid` without aborting the batch', async () => {
      registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
      const localFp = registry.get('a.x')!.schemaFingerprint;
      const res = await request(app).post('/api/freshness').send({
        events: [
          { name: 'a.x', fingerprint: localFp },        // ok
          { name: 'b.y' },                              // missing fingerprint
          { fingerprint: 'whatever' },                  // missing name
        ],
      });
      expect(res.status).toBe(200);
      expect(res.body.reports[0].status).toBe('fresh');
      expect(res.body.reports[1].status).toBe('invalid');
      expect(res.body.reports[2].status).toBe('invalid');
    });

    it('rejects body without events[] with 400', async () => {
      const res = await request(app).post('/api/freshness').send({});
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('events must be an array');
    });

    it('handles an empty events[] (returns empty reports)', async () => {
      const res = await request(app).post('/api/freshness').send({ events: [] });
      expect(res.status).toBe(200);
      expect(res.body.reports).toEqual([]);
    });
  });

  // ─── POST /api/transports/durable/dlq/replay (Phase E5.2) ────────────

  describe('POST /api/transports/durable/dlq/replay', () => {
    type FakeEntry = { id: string; eventName: string; payload: unknown };

    function createAppWithDlq(entries: FakeEntry[], publishImpl?: (queue: string, env: unknown) => Promise<void>) {
      const remaining = new Map(entries.map((e) => [e.id, e]));
      const removed: string[] = [];
      const published: Array<{ queue: string; envelope: unknown }> = [];

      const dlqStore = {
        findById: async (id: string) => remaining.get(id) ?? null,
        remove: async (id: string) => {
          const had = remaining.delete(id);
          if (had) removed.push(id);
          return had;
        },
        list: async () => [],
        put: async () => ({}),
      } as unknown as RoutesDeps['dlqStore'];

      const durableWithPublish = {
        ...durable,
        publish: publishImpl ?? (async (queue: string, env: unknown) => {
          published.push({ queue, envelope: env });
        }),
      };

      const localApp = createApp({
        registry,
        metrics,
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: signal as unknown as RoutesDeps['signal'],
        durable: durableWithPublish as unknown as RoutesDeps['durable'],
        dlqStore,
        startedAt: Date.now(),
      });

      return { localApp, removed, published, remaining };
    }

    it('redrives every supplied id, returns a per-id breakdown', async () => {
      const { localApp, removed, published } = createAppWithDlq([
        { id: 'a1', eventName: 'orders.failed', payload: { x: 1 } },
        { id: 'a2', eventName: 'orders.failed', payload: { x: 2 } },
      ]);

      const res = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({ ids: ['a1', 'a2'] });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(2);
      expect(res.body.replayed).toHaveLength(2);
      expect(res.body.failed).toHaveLength(0);
      expect(removed).toEqual(['a1', 'a2']);
      expect(published).toHaveLength(2);
      // Envelope reuses the DLQ entry id as the message id (idempotency key).
      expect((published[0]!.envelope as { metadata: { id: string } }).metadata.id).toBe('a1');
    });

    it('partial failure: missing ids land in failed[], successful ids in replayed[]', async () => {
      const { localApp } = createAppWithDlq([
        { id: 'found-1', eventName: 'orders.failed', payload: {} },
      ]);

      const res = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({ ids: ['found-1', 'missing-2'] });

      expect(res.status).toBe(200);
      expect(res.body.replayed.map((r: { id: string }) => r.id)).toEqual(['found-1']);
      expect(res.body.failed).toEqual([{ id: 'missing-2', error: 'not found' }]);
      expect(res.body.total).toBe(2);
    });

    it('publish error surfaces in failed[] but does not abort the batch', async () => {
      let calls = 0;
      const failingPublish = async () => {
        calls += 1;
        if (calls === 1) throw new Error('queue offline');
      };
      const { localApp } = createAppWithDlq(
        [
          { id: 'b1', eventName: 'orders.failed', payload: {} },
          { id: 'b2', eventName: 'orders.failed', payload: {} },
        ],
        failingPublish,
      );

      const res = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({ ids: ['b1', 'b2'] });

      expect(res.status).toBe(200);
      expect(res.body.replayed).toHaveLength(1);
      expect(res.body.failed).toEqual([{ id: 'b1', error: 'queue offline' }]);
    });

    it('rejects empty or malformed ids array with 400', async () => {
      const { localApp } = createAppWithDlq([]);

      const empty = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({ ids: [] });
      expect(empty.status).toBe(400);

      const wrong = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({ ids: ['a', 42] });
      expect(wrong.status).toBe(400);

      const missing = await request(localApp)
        .post('/api/transports/durable/dlq/replay')
        .send({});
      expect(missing.status).toBe(400);
    });
  });
});

// ─── metricsObserver.observe() wiring ────────────────────────────────────────

describe('routes → metricsObserver.observe() wiring', () => {
  function makeApp(observeSpy: ReturnType<typeof vi.fn>) {
    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes({
      registry: new Registry(),
      metrics: new MetricsCollector(60),
      metricsObserver: { observe: observeSpy } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      startedAt: Date.now(),
    }));
    return app;
  }

  it('POST /api/events calls metricsObserver.observe with eventName and transport', async () => {
    const observeSpy = vi.fn(async () => {});
    await request(makeApp(observeSpy))
      .post('/api/events')
      .send({ name: 'wired.event', schema: { type: 'object' }, transport: 'signal', producer: 'svc' })
      .expect(201);

    await Promise.resolve(); // let the fire-and-forget .catch() settle
    expect(observeSpy).toHaveBeenCalledWith('wired.event', 'signal');
  });

  it('POST /api/events/bulk calls metricsObserver.observe once per declared event', async () => {
    const observeSpy = vi.fn(async () => {});
    await request(makeApp(observeSpy))
      .post('/api/events/bulk')
      .send({
        serviceName: 'batch-svc',
        events: [
          { name: 'bulk.one', schema: { type: 'object' }, transport: 'signal' },
          { name: 'bulk.two', schema: { type: 'object' }, transport: 'durable' },
        ],
      })
      .expect(201);

    await Promise.resolve();
    expect(observeSpy).toHaveBeenCalledTimes(2);
    expect(observeSpy).toHaveBeenCalledWith('bulk.one', 'signal');
    expect(observeSpy).toHaveBeenCalledWith('bulk.two', 'durable');
  });
});

describe('POST /events with aliases round-trip (routes.ts:363)', () => {
  it('aliases passed via HTTP are stored and resolve() finds the event by legacy name', async () => {
    const registry = new Registry();
    const app = createApp({
      registry,
      metrics: new MetricsCollector(60),
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      dlqStore: {} as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
    });

    const res = await request(app)
      .post('/api/events')
      .send({
        name: 'order.placed',
        schema: { type: 'object' },
        transport: 'durable',
        producer: 'orders-svc',
        aliases: [{ name: 'order_placed', deprecated: true, until: '2027-01-01' }],
      });

    expect(res.status).toBe(201);
    // The alias should be stored and resolve() should find the canonical entry.
    const via = registry.resolve('order_placed');
    expect(via).toBeDefined();
    expect(via!.entry.name).toBe('order.placed');
    expect(via!.viaAlias?.name).toBe('order_placed');
  });
});
