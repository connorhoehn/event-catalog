// tests/events-filter-subscriber-tag.test.ts
//
// Tests for the ?subscriber= and ?tag= query filters on GET /api/events.
// The existing routes.test.ts covers ?transport= and ?producer= but not
// these two. Consumers and operators use these filters to answer:
//   - "which events does fulfillment-service subscribe to?" (?subscriber=)
//   - "which events are tagged 'billing'?" (?tag=)

import { describe, it, expect, beforeEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp(registry: Registry) {
    const deps: RoutesDeps = {
        registry,
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
        } as unknown as RoutesDeps['durable'],
        dlqStore: {
            list: async () => [],
            remove: async () => true,
            findById: async () => null,
            put: async () => ({}),
            clear: async () => 0,
        } as unknown as RoutesDeps['dlqStore'],
        startedAt: Date.now(),
    };

    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));
    return app;
}

// ─── GET /api/events?subscriber= ─────────────────────────────────────────────

describe('GET /api/events?subscriber=', () => {
    let registry: Registry;

    beforeEach(() => {
        registry = new Registry();
        registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: 'platform-api' });
        registry.declare({ name: 'orders.cancelled', schema: {}, transport: 'durable', producer: 'platform-api' });
        registry.declare({ name: 'user.created', schema: {}, transport: 'signal', producer: 'platform-api' });

        registry.addSubscriber('orders.placed', 'fulfillment-service');
        registry.addSubscriber('orders.cancelled', 'fulfillment-service');
        registry.addSubscriber('user.created', 'email-service');
    });

    it('returns only events subscribed to by the specified service', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?subscriber=fulfillment-service');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        const names = res.body.events.map((e: { name: string }) => e.name);
        expect(names).toContain('orders.placed');
        expect(names).toContain('orders.cancelled');
        expect(names).not.toContain('user.created');
    });

    it('returns empty list when no events are subscribed by the given service', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?subscriber=unknown-service');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
        expect(res.body.events).toHaveLength(0);
    });

    it('returns only the event subscribed by a service with a single subscription', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?subscriber=email-service');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.events[0].name).toBe('user.created');
    });
});

// ─── GET /api/events?producer= with array-producer ────────────────────────────

describe('GET /api/events?producer= — array-producer (registry/index.ts:219)', () => {
    it('finds an event when querying by any one of its array producers', async () => {
        const registry = new Registry();
        // Array producer — two authoritative sources for this event.
        registry.declare({ name: 'order.shipped', schema: {}, transport: 'durable', producer: ['platform-api', 'billing-service'] });
        // Single-producer control event.
        registry.declare({ name: 'user.created', schema: {}, transport: 'signal', producer: 'auth-service' });
        const app = createApp(registry);

        // Both array-producer values should independently return the event.
        const res1 = await request(app).get('/api/events?producer=platform-api');
        expect(res1.status).toBe(200);
        expect(res1.body.events.map((e: { name: string }) => e.name)).toContain('order.shipped');
        expect(res1.body.events.map((e: { name: string }) => e.name)).not.toContain('user.created');

        const res2 = await request(app).get('/api/events?producer=billing-service');
        expect(res2.status).toBe(200);
        expect(res2.body.events.map((e: { name: string }) => e.name)).toContain('order.shipped');
        expect(res2.body.events.map((e: { name: string }) => e.name)).not.toContain('user.created');

        // A producer not in the array should not return the event.
        const res3 = await request(app).get('/api/events?producer=other-service');
        expect(res3.status).toBe(200);
        expect(res3.body.events.map((e: { name: string }) => e.name)).not.toContain('order.shipped');
    });
});

// ─── GET /api/events?transport=both ──────────────────────────────────────────

describe('GET /api/events?transport=both (routes.ts:86 transport filter)', () => {
    it('returns only transport:both events, not signal or durable', async () => {
        const registry = new Registry();
        registry.declare({ name: 'sig.event', schema: {}, transport: 'signal', producer: 'svc' });
        registry.declare({ name: 'dur.event', schema: {}, transport: 'durable', producer: 'svc' });
        registry.declare({ name: 'both.event', schema: {}, transport: 'both', producer: 'svc' });
        const app = createApp(registry);

        const res = await request(app).get('/api/events?transport=both');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        const names = res.body.events.map((e: { name: string }) => e.name);
        expect(names).toContain('both.event');
        expect(names).not.toContain('sig.event');
        expect(names).not.toContain('dur.event');
    });
});

// ─── GET /api/events?tag= ─────────────────────────────────────────────────────

describe('GET /api/events?tag=', () => {
    let registry: Registry;

    beforeEach(() => {
        registry = new Registry();
        registry.declare({
            name: 'orders.placed',
            schema: {},
            transport: 'durable',
            producer: 'platform-api',
            tags: ['billing', 'commerce'],
        });
        registry.declare({
            name: 'orders.cancelled',
            schema: {},
            transport: 'durable',
            producer: 'platform-api',
            tags: ['commerce'],
        });
        registry.declare({
            name: 'user.created',
            schema: {},
            transport: 'signal',
            producer: 'platform-api',
            tags: ['auth', 'billing'],
        });
        registry.declare({
            name: 'pipeline.run.started',
            schema: {},
            transport: 'signal',
            producer: 'distributed-core',
            // no tags
        });
    });

    it('returns events tagged with the specified tag', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?tag=billing');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        const names = res.body.events.map((e: { name: string }) => e.name);
        expect(names).toContain('orders.placed');
        expect(names).toContain('user.created');
        expect(names).not.toContain('orders.cancelled');
        expect(names).not.toContain('pipeline.run.started');
    });

    it('returns events tagged with commerce', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?tag=commerce');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        const names = res.body.events.map((e: { name: string }) => e.name);
        expect(names).toContain('orders.placed');
        expect(names).toContain('orders.cancelled');
    });

    it('returns empty list when no events carry the given tag', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events?tag=does-not-exist');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
        expect(res.body.events).toHaveLength(0);
    });

    it('returns all events when no tag filter is applied', async () => {
        const app = createApp(registry);
        const res = await request(app).get('/api/events');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(4);
    });
});
