// tests/schema-check-audit-subscribers.test.ts
//
// Route-level tests for three endpoints with no HTTP-layer coverage:
//   GET /api/events/:name/schema/check  — producer compat check before deploy
//   GET /api/audit/recent               — persistent audit log query
//   GET /api/subscribers                — subscriber heartbeat listing

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import type { AuditEvent } from '../src/server/audit-emitter.js';

function createApp(overrides: Partial<RoutesDeps> = {}) {
    const deps: RoutesDeps = {
        registry: new Registry(),
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
            publish: vi.fn(),
        } as unknown as RoutesDeps['durable'],
        dlqStore: {
            list: vi.fn(async () => []),
            remove: vi.fn(async () => true),
            findById: vi.fn(async () => null),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'],
        startedAt: Date.now(),
        ...overrides,
    };

    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));
    return { app, deps };
}

// ─── GET /api/events/:name/schema/check ──────────────────────────────────────

describe('GET /api/events/:name/schema/check', () => {
    let registry: Registry;

    beforeEach(() => {
        registry = new Registry();
    });

    it('returns 404 when the event does not exist', async () => {
        const { app } = createApp({ registry });
        const res = await request(app)
            .get('/api/events/no.such.event/schema/check')
            .send({ schema: { type: 'object' } });
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('no.such.event');
    });

    it('returns 400 when schema is missing from request body', async () => {
        registry.declare({ name: 'orders.placed', schema: { type: 'object' }, transport: 'durable', producer: 'platform-api' });
        const { app } = createApp({ registry });

        const res = await request(app).get('/api/events/orders.placed/schema/check').send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toContain('schema is required');
    });

    it('returns compatible: true when proposed schema is backward-compatible', async () => {
        registry.declare({
            name: 'orders.placed',
            schema: { type: 'object', properties: { orderId: { type: 'string' } }, required: ['orderId'] },
            transport: 'durable',
            producer: 'platform-api',
        });
        const { app } = createApp({ registry });

        // Adding an optional field is backward-compatible
        const res = await request(app)
            .get('/api/events/orders.placed/schema/check')
            .send({
                schema: {
                    type: 'object',
                    properties: {
                        orderId: { type: 'string' },
                        amount: { type: 'number' },
                    },
                    required: ['orderId'],
                },
            });
        expect(res.status).toBe(200);
        expect(res.body.compatible).toBe(true);
        expect(res.body.violations).toHaveLength(0);
        expect(res.body.eventName).toBe('orders.placed');
    });

    it('returns compatible: false when a required field is removed', async () => {
        registry.declare({
            name: 'orders.placed',
            schema: {
                type: 'object',
                properties: { orderId: { type: 'string' }, userId: { type: 'string' } },
                required: ['orderId', 'userId'],
            },
            transport: 'durable',
            producer: 'platform-api',
        });
        const { app } = createApp({ registry });

        // Removing userId from required breaks backward compat
        const res = await request(app)
            .get('/api/events/orders.placed/schema/check')
            .send({
                schema: {
                    type: 'object',
                    properties: { orderId: { type: 'string' } },
                    required: ['orderId'],
                },
            });
        expect(res.status).toBe(200);
        expect(res.body.compatible).toBe(false);
        expect(res.body.violations.length).toBeGreaterThan(0);
    });

    it('includes currentVersion and compatibilityMode in response', async () => {
        registry.declare({
            name: 'user.created',
            schema: { type: 'object' },
            transport: 'signal',
            producer: 'platform-api',
        });
        const { app } = createApp({ registry });

        const res = await request(app)
            .get('/api/events/user.created/schema/check')
            .send({ schema: { type: 'object' } });
        expect(res.status).toBe(200);
        expect(typeof res.body.currentVersion).toBe('number');
        expect(typeof res.body.compatibilityMode).toBe('string');
    });
});

// ─── GET /api/audit/recent ────────────────────────────────────────────────────

describe('GET /api/audit/recent', () => {
    it('returns empty events with a note when no auditLog is wired', async () => {
        const { app } = createApp();
        const res = await request(app).get('/api/audit/recent');
        expect(res.status).toBe(200);
        expect(res.body.events).toHaveLength(0);
        expect(typeof res.body.note).toBe('string');
    });

    it('returns events from the audit log when wired', async () => {
        const mockEvent: AuditEvent = {
            kind: 'event.declared',
            timestamp: '2026-05-15T10:00:00.000Z',
            eventName: 'orders.placed',
            namespace: 'orders',
            version: 1,
            fingerprint: 'a'.repeat(64),
        };
        const auditLog = { recent: vi.fn(async () => [mockEvent]) };
        const { app } = createApp({ auditLog });

        const res = await request(app).get('/api/audit/recent');
        expect(res.status).toBe(200);
        expect(res.body.events).toHaveLength(1);
        expect(res.body.events[0].eventName).toBe('orders.placed');
    });

    it('passes the limit query param to auditLog.recent()', async () => {
        const recentFn = vi.fn(async () => []);
        const { app } = createApp({ auditLog: { recent: recentFn } });

        await request(app).get('/api/audit/recent?limit=25');
        expect(recentFn).toHaveBeenCalledWith(25);
    });

    it('defaults to limit 50 when limit=0 is provided', async () => {
        const recentFn = vi.fn(async () => []);
        const { app } = createApp({ auditLog: { recent: recentFn } });

        // The route treats 0 (falsy) the same as missing, falling back to 50
        await request(app).get('/api/audit/recent?limit=0');
        expect(recentFn).toHaveBeenCalledWith(50);
    });
});

// ─── GET /api/subscribers ─────────────────────────────────────────────────────

describe('GET /api/subscribers', () => {
    let registry: Registry;

    beforeEach(() => {
        registry = new Registry();
    });

    it('returns empty list when no subscribers are registered', async () => {
        const { app } = createApp({ registry });
        const res = await request(app).get('/api/subscribers');
        expect(res.status).toBe(200);
        expect(res.body.subscribers).toHaveLength(0);
        expect(res.body.total).toBe(0);
    });

    it('returns all subscribers with their lastSeenAt field', async () => {
        registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: 'platform-api' });
        registry.addSubscriber('orders.placed', 'fulfillment-service');
        const { app } = createApp({ registry });

        const res = await request(app).get('/api/subscribers');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(1);
        expect(res.body.subscribers[0].serviceName).toBe('fulfillment-service');
        expect(res.body.subscribers[0].eventName).toBe('orders.placed');
        expect(typeof res.body.subscribers[0].lastSeenAt).toBe('string');
    });

    it('returns subscribers array with filter metadata when staleAfter is set', async () => {
        registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: 'platform-api' });
        registry.addSubscriber('orders.placed', 'active-service');
        // addSubscriber stamps a heartbeat at ~now, so with staleAfter=1 the
        // service is fresh and should NOT appear in the stale list
        const { app } = createApp({ registry });

        const res = await request(app).get('/api/subscribers?staleAfter=1');
        expect(res.status).toBe(200);
        expect(res.body.filter).toMatchObject({ staleAfter: 1 });
        // active-service heartbeated at ~now so it is not stale
        const activeInStale = res.body.subscribers.some(
            (s: { serviceName: string }) => s.serviceName === 'active-service',
        );
        expect(activeInStale).toBe(false);
    });

    it('returns all subscribers when no staleAfter filter is applied', async () => {
        registry.declare({ name: 'orders.placed', schema: {}, transport: 'durable', producer: 'platform-api' });
        registry.addSubscriber('orders.placed', 'fulfillment-service');
        registry.addSubscriber('orders.placed', 'notification-service');
        const { app } = createApp({ registry });

        const res = await request(app).get('/api/subscribers');
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(2);
        // No filter field when staleAfter is absent
        expect(res.body.filter).toBeUndefined();
    });
});
