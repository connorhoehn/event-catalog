// tests/dlq-clear-route.test.ts
//
// Tests for POST /api/transports/durable/dlq/clear — the bulk-clear
// endpoint that was missing despite DLQStore.clear() being implemented.
// Operators use this to purge test noise or retire a dead event's DLQ
// before M2 goes live.

import { describe, it, expect, vi } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp(clearFn: ReturnType<typeof vi.fn>) {
    const dlqStore: RoutesDeps['dlqStore'] = {
        list: vi.fn(async () => []),
        remove: vi.fn(async () => true),
        findById: vi.fn(async () => null),
        put: vi.fn(),
        clear: clearFn,
    } as unknown as RoutesDeps['dlqStore'];

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
        dlqStore,
        startedAt: Date.now(),
    };

    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));
    return app;
}

describe('POST /api/transports/durable/dlq/clear', () => {
    it('returns 200 with cleared: 0 when there are no entries', async () => {
        const clearFn = vi.fn(async () => 0);
        const app = createApp(clearFn);

        const res = await request(app).post('/api/transports/durable/dlq/clear');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(0);
    });

    it('returns the count of cleared entries', async () => {
        const clearFn = vi.fn(async () => 42);
        const app = createApp(clearFn);

        const res = await request(app).post('/api/transports/durable/dlq/clear');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(42);
    });

    it('calls dlqStore.clear() with no argument when eventName is absent', async () => {
        const clearFn = vi.fn(async () => 0);
        const app = createApp(clearFn);

        await request(app).post('/api/transports/durable/dlq/clear');
        expect(clearFn).toHaveBeenCalledWith(undefined);
    });

    it('passes ?eventName= to dlqStore.clear() to scope the clear', async () => {
        const clearFn = vi.fn(async () => 5);
        const app = createApp(clearFn);

        const res = await request(app).post('/api/transports/durable/dlq/clear?eventName=orders.failed');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(5);
        expect(clearFn).toHaveBeenCalledWith('orders.failed');
    });

    it('calls dlqStore.clear() exactly once per request', async () => {
        const clearFn = vi.fn(async () => 3);
        const app = createApp(clearFn);

        await request(app).post('/api/transports/durable/dlq/clear');
        expect(clearFn).toHaveBeenCalledTimes(1);
    });

    // ─── Input validation: reject malformed query strings rather than
    //     silently coercing to phantom scopes (hub #898).
    it('rejects duplicate ?eventName=A&eventName=B with 400 (array silently mis-targets the clear scope)', async () => {
        const clearFn = vi.fn(async () => 0);
        const app = createApp(clearFn);

        const res = await request(app).post('/api/transports/durable/dlq/clear?eventName=A&eventName=B');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/eventName/);
        expect(clearFn).not.toHaveBeenCalled();
    });

    it('treats whitespace-only ?eventName= as no filter (full-clear) rather than scoping to a whitespace partition', async () => {
        const clearFn = vi.fn(async () => 7);
        const app = createApp(clearFn);

        const res = await request(app).post('/api/transports/durable/dlq/clear?eventName=%20');
        expect(res.status).toBe(200);
        expect(res.body.cleared).toBe(7);
        expect(clearFn).toHaveBeenCalledWith(undefined);
    });
});
