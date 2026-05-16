// tests/namespace.test.ts
//
// Phase E7 — namespace derivation + filter coverage.

import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';

import { deriveNamespace, resolveNamespace } from '../src/registry/namespace.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

describe('deriveNamespace', () => {
  it('takes the segment before the first dot', () => {
    expect(deriveNamespace('pipeline.approval.requested')).toBe('pipeline');
    expect(deriveNamespace('sfu.stream.started')).toBe('sfu');
    expect(deriveNamespace('ws.chat.message')).toBe('ws');
  });

  it('takes the segment before the first colon when no dot exists', () => {
    expect(deriveNamespace('pipeline:run:started')).toBe('pipeline');
    expect(deriveNamespace('crdt:update')).toBe('crdt');
  });

  it('takes the segment before whichever delimiter appears first', () => {
    // dot wins
    expect(deriveNamespace('ws.pipeline:event')).toBe('ws');
    // colon wins
    expect(deriveNamespace('ws:pipeline.event')).toBe('ws');
  });

  it('returns the whole name for single-word events', () => {
    expect(deriveNamespace('error')).toBe('error');
    expect(deriveNamespace('social')).toBe('social');
  });

  it('returns empty string for an empty input rather than throwing', () => {
    expect(deriveNamespace('')).toBe('');
  });
});

describe('resolveNamespace', () => {
  it('uses the explicit namespace when provided', () => {
    expect(resolveNamespace('pipeline.approval.requested', 'workflow')).toBe('workflow');
  });

  it('falls back to derived when the explicit value is empty/whitespace', () => {
    expect(resolveNamespace('pipeline.approval.requested', '')).toBe('pipeline');
    expect(resolveNamespace('pipeline.approval.requested', '   ')).toBe('pipeline');
  });

  it('falls back to derived when the explicit value is undefined', () => {
    expect(resolveNamespace('sfu.stream.started', undefined)).toBe('sfu');
  });
});

describe('Registry — namespace handling', () => {
  it('auto-derives namespace from the event name when not declared', () => {
    const reg = new Registry();
    reg.declare({
      name: 'pipeline.approval.requested',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'distributed-core',
    });
    expect(reg.get('pipeline.approval.requested')!.namespace).toBe('pipeline');
  });

  it('honors explicit namespace over the derived one', () => {
    const reg = new Registry();
    reg.declare({
      name: 'pipeline.approval.requested',
      namespace: 'workflow',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'distributed-core',
    });
    expect(reg.get('pipeline.approval.requested')!.namespace).toBe('workflow');
  });

  it('list({ namespace }) filters to events in that namespace', () => {
    const reg = new Registry();
    reg.declare({ name: 'pipeline.run.started', schema: {}, transport: 'durable', producer: 'dc' });
    reg.declare({ name: 'pipeline.run.completed', schema: {}, transport: 'durable', producer: 'dc' });
    reg.declare({ name: 'sfu.stream.started', schema: {}, transport: 'durable', producer: 'sfu' });

    const ns = reg.list({ namespace: 'pipeline' });
    expect(ns).toHaveLength(2);
    expect(ns.every((e) => e.namespace === 'pipeline')).toBe(true);
  });

  it('topology({ namespace }) filters the induced subgraph', () => {
    const reg = new Registry();
    reg.declare({ name: 'pipeline.run.started', schema: {}, transport: 'durable', producer: 'dc' });
    reg.declare({ name: 'sfu.stream.started', schema: {}, transport: 'durable', producer: 'sfu-cluster' });

    const topology = reg.getTopology({ namespace: 'sfu' });
    const eventNodes = topology.nodes.filter((n) => n.type === 'event');
    expect(eventNodes).toHaveLength(1);
    expect(eventNodes[0]!.id).toBe('sfu.stream.started');
    // Producer 'sfu-cluster' should be the only induced service node.
    const services = topology.nodes.filter((n) => n.type === 'service').map((n) => n.id);
    expect(services).toContain('sfu-cluster');
    expect(services).not.toContain('dc');
  });
});

describe('HTTP — namespace surface', () => {
  function makeApp() {
    const registry = new Registry();
    const metrics = new MetricsCollector(60);
    const app = express();
    app.use(express.json());
    app.use(
      '/api',
      createRoutes({
        registry,
        metrics,
        metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
        signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
        durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
        dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
        startedAt: Date.now(),
      }),
    );
    return { app, registry };
  }

  it('GET /api/events?namespace=X filters to only that namespace', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'pipeline.run.started', schema: {}, transport: 'durable', producer: 'dc' });
    registry.declare({ name: 'sfu.stream.started', schema: {}, transport: 'durable', producer: 'sfu' });

    const res = await request(app).get('/api/events?namespace=sfu');
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.events[0].name).toBe('sfu.stream.started');
    expect(res.body.events[0].namespace).toBe('sfu');
  });

  it('GET /api/topology?namespace=X filters the induced subgraph', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'pipeline.run.started', schema: {}, transport: 'durable', producer: 'dc' });
    registry.declare({ name: 'sfu.stream.started', schema: {}, transport: 'durable', producer: 'sfu-cluster' });

    const res = await request(app).get('/api/topology?namespace=pipeline');
    expect(res.status).toBe(200);
    const events = res.body.nodes.filter((n: { type: string }) => n.type === 'event');
    expect(events.map((n: { id: string }) => n.id)).toEqual(['pipeline.run.started']);
  });

  it('POST /api/events accepts an explicit namespace and round-trips it on GET', async () => {
    const { app } = makeApp();
    const post = await request(app).post('/api/events').send({
      name: 'foo.bar',
      namespace: 'platform',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'svc',
    });
    expect(post.status).toBe(201);

    const get = await request(app).get('/api/events/foo.bar');
    expect(get.body.namespace).toBe('platform');
  });

  it('POST /api/events without namespace stores the auto-derived value', async () => {
    const { app } = makeApp();
    const post = await request(app).post('/api/events').send({
      name: 'pipeline.run.started',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'dc',
    });
    expect(post.status).toBe(201);

    const get = await request(app).get('/api/events/pipeline.run.started');
    expect(get.body.namespace).toBe('pipeline');
  });

  it('GET /api/events?namespace=X returns the namespace field on every entry', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: {}, transport: 'signal', producer: 's' });
    registry.declare({ name: 'a.y', schema: {}, transport: 'signal', producer: 's' });
    registry.declare({ name: 'a.z', schema: {}, transport: 'signal', producer: 's' });

    const res = await request(app).get('/api/events?namespace=a');
    expect(res.body.total).toBe(3);
    expect(res.body.events.every((e: { namespace: string }) => e.namespace === 'a')).toBe(true);
  });

  it('GET /api/namespaces returns {namespace, eventCount}[] sorted by name (Phase E7)', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'pipeline.run.started', schema: {}, transport: 'durable', producer: 'dc' });
    registry.declare({ name: 'pipeline.run.done', schema: {}, transport: 'durable', producer: 'dc' });
    registry.declare({ name: 'sfu.stream.started', schema: {}, transport: 'signal', producer: 'sfu' });

    const res = await request(app).get('/api/namespaces');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
    const byName = Object.fromEntries(res.body.items.map((i: { namespace: string; eventCount: number }) => [i.namespace, i.eventCount]));
    expect(byName['pipeline']).toBe(2);
    expect(byName['sfu']).toBe(1);
    // sorted alphabetically
    expect(res.body.items[0].namespace).toBe('pipeline');
    expect(res.body.items[1].namespace).toBe('sfu');
  });
});
