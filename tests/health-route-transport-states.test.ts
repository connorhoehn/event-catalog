// tests/health-route-transport-states.test.ts
//
// Tests for GET /api/health transport state transitions. The existing
// routes.test.ts covers the 'healthy' (200) and 'unhealthy' (503) cases.
// This file adds the missing 'degraded' cases that matter for k8s readiness
// probes: degraded still returns 200 (service should receive traffic), only
// 'unhealthy' triggers 503 (service should be removed from load balancer).

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

type TransportHealth = { status: 'connected' | 'degraded' | 'disconnected'; latencyMs: number };

function createApp(signalHealth: TransportHealth, durableHealth: TransportHealth) {
    const deps: RoutesDeps = {
        registry: new Registry(),
        metrics: new MetricsCollector(60),
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: {
            isConnected: () => signalHealth.status !== 'disconnected',
            healthCheck: async () => signalHealth,
            getAllMetrics: () => new Map(),
            getHistory: async () => [],
        } as unknown as RoutesDeps['signal'],
        durable: {
            isConnected: () => durableHealth.status !== 'disconnected',
            healthCheck: async () => durableHealth,
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

    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes(deps));
    return app;
}

describe('GET /api/health — transport state transitions', () => {
    it('returns 200 + status: degraded when signal is degraded and durable is connected', async () => {
        const app = createApp(
            { status: 'degraded', latencyMs: 9999 },
            { status: 'connected', latencyMs: 1 },
        );
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.redis.status).toBe('degraded');
        expect(res.body.messageQueue.status).toBe('connected');
    });

    it('returns 200 + status: degraded when durable is degraded and signal is connected', async () => {
        const app = createApp(
            { status: 'connected', latencyMs: 1 },
            { status: 'degraded', latencyMs: 9999 },
        );
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
        expect(res.body.redis.status).toBe('connected');
        expect(res.body.messageQueue.status).toBe('degraded');
    });

    it('returns 200 + status: degraded when both transports are degraded', async () => {
        const app = createApp(
            { status: 'degraded', latencyMs: 5000 },
            { status: 'degraded', latencyMs: 5000 },
        );
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('degraded');
    });

    it('returns 503 + status: unhealthy when signal disconnected even if durable is degraded', async () => {
        // 'disconnected' beats 'degraded' — service should be ejected from LB
        const app = createApp(
            { status: 'disconnected', latencyMs: -1 },
            { status: 'degraded', latencyMs: 5000 },
        );
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(503);
        expect(res.body.status).toBe('unhealthy');
    });

    it('response includes uptime and eventCount regardless of status', async () => {
        const app = createApp(
            { status: 'degraded', latencyMs: 500 },
            { status: 'connected', latencyMs: 1 },
        );
        const res = await request(app).get('/api/health');
        expect(typeof res.body.uptime).toBe('number');
        expect(res.body.uptime).toBeGreaterThanOrEqual(0);
        expect(typeof res.body.eventCount).toBe('number');
    });
});
