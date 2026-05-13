import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
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
});
