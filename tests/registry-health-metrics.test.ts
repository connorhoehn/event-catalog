// tests/registry-health-metrics.test.ts
//
// HTTP-layer tests for GET /health/registry (wave26-b) and
// GET /api/metrics/history (wave26-a). These endpoints have unit coverage
// for their data layers (MetricsCollector, Registry) but no route-level tests.

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

function createApp(registry: Registry, metrics: MetricsCollector) {
    const deps: RoutesDeps = {
        registry,
        metrics,
        signal: {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 2 }),
            getAllMetrics: () => new Map(),
            getHistory: async () => [],
        },
        durable: {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 5 }),
            getAllMetrics: () => new Map(),
        },
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        dlqStore: {} as unknown as RoutesDeps['dlqStore'],
        startedAt: Date.now(),
    } as RoutesDeps;

    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes(deps));
    return app;
}

describe('GET /api/health/registry', () => {
    let registry: Registry;
    let metrics: MetricsCollector;

    beforeEach(() => {
        registry = new Registry();
        metrics = new MetricsCollector(60);
    });

    it('returns 200 with required fields on an empty registry', async () => {
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({
            registrySize: 0,
            namespaceCount: 0,
            deprecatedCount: 0,
            orphanCount: 0,
        });
        expect(typeof res.body.capturedAt).toBe('string');
    });

    it('registrySize reflects declared events', async () => {
        registry.declare({ name: 'user.signed-up', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.declare({ name: 'order.placed', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.status).toBe(200);
        expect(res.body.registrySize).toBe(2);
    });

    it('namespaceCount reflects distinct namespaces', async () => {
        registry.declare({ name: 'user.signed-up', namespace: 'user', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.declare({ name: 'order.placed', namespace: 'order', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.declare({ name: 'order.cancelled', namespace: 'order', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.body.namespaceCount).toBe(2);
        expect(res.body.registrySize).toBe(3);
    });

    it('deprecatedCount increments when event is deprecated', async () => {
        registry.declare({ name: 'legacy.event', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.deprecate('legacy.event', { reason: 'replaced by new.event', by: 'test' });
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.body.deprecatedCount).toBe(1);
    });

    it('orphanCount counts events with no subscribers', async () => {
        registry.declare({ name: 'no.subscribers', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.declare({ name: 'has.subscribers', transport: 'signal', producer: 'platform-api', schema: { type: 'object' } });
        registry.addSubscriber('has.subscribers', 'some-service');
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.body.orphanCount).toBe(1);
    });

    it('includes transport health from signal and durable', async () => {
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/health/registry');
        expect(res.body.signal).toMatchObject({ status: 'connected' });
        expect(res.body.durable).toMatchObject({ status: 'connected' });
    });
});

describe('GET /api/metrics/history', () => {
    let registry: Registry;
    let metrics: MetricsCollector;

    beforeEach(() => {
        registry = new Registry();
        metrics = new MetricsCollector(60);
    });

    it('returns 200 with empty object when no events have been recorded', async () => {
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/metrics/history');
        expect(res.status).toBe(200);
        expect(typeof res.body).toBe('object');
    });

    it('returns history after events have been published and ticked', async () => {
        metrics.recordPublish('pipeline.run.started');
        metrics.tickRateHistory();
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/metrics/history');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body['pipeline.run.started'])).toBe(true);
        expect(res.body['pipeline.run.started']).toHaveLength(1);
    });

    it('filters by ?eventName= when provided', async () => {
        metrics.recordPublish('event.a');
        metrics.recordPublish('event.b');
        metrics.tickRateHistory();
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/metrics/history?eventName=event.a');
        expect(res.status).toBe(200);
        expect(Object.keys(res.body)).toContain('event.a');
        expect(Object.keys(res.body)).not.toContain('event.b');
    });

    it('returns empty array for unknown eventName', async () => {
        const app = createApp(registry, metrics);
        const res = await request(app).get('/api/metrics/history?eventName=no.such.event');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ 'no.such.event': [] });
    });
});
