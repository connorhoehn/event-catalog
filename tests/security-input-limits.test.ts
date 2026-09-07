// tests/security-input-limits.test.ts
//
// Bounds on operator-supplied JSON reaching the mutating /api routes.
//
// The server advertises a 1 MiB body cap (tests/server-body-limits.test.ts
// proves it is enforced), but that caps BYTES, not the amount of state or
// work a single in-budget request creates. A minimal declaration is ~35
// bytes, so one 1 MiB POST /api/events/bulk carried tens of thousands of
// declarations — each producing a registry entry, a Redis hash field, six
// distributed-core metric handles and a rate-history ring buffer, all of
// which outlive the request. Before the fix a 20 000-element body was
// accepted whole and left 20 000 entries in the registry.
//
// These tests pin the per-collection ceilings and the event-name guard.

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import {
  MAX_BULK_EVENTS,
  MAX_BULK_DEPRECATE_NAMES,
  MAX_DLQ_REPLAY_IDS,
  MAX_FRESHNESS_EVENTS,
  MAX_MANIFEST_EVENTS,
  MAX_CONSUMER_NAME_LENGTH,
  MAX_EVENT_NAME_LENGTH,
  validateEventName,
} from '../src/server/routes/limits.js';
import type { ManifestStore } from '../src/server/manifest-store.js';

function memoryManifestStore(): ManifestStore {
  const store = new Map<string, { consumerName: string; events: Array<{ name: string; fingerprint: string }>; updatedAt: string }>();
  return {
    async put(entry) {
      const stored = { ...entry, updatedAt: new Date().toISOString() };
      store.set(entry.consumerName, stored);
      return stored;
    },
    async get(name) { return store.get(name) ?? null; },
    async list() { return [...store.values()]; },
    async remove(name) { return store.delete(name); },
    async driftReport() { return []; },
  };
}

function makeDeps(): RoutesDeps {
  return {
    registry: new Registry(),
    metrics: new MetricsCollector(60),
    metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
    signal: {
      isConnected: () => true,
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
    } as unknown as RoutesDeps['signal'],
    durable: {
      healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
      getAllMetrics: () => new Map(),
      getDLQ: () => [],
      publish: async () => {},
    } as unknown as RoutesDeps['durable'],
    dlqStore: {
      findById: async () => null,
    } as unknown as RoutesDeps['dlqStore'],
    startedAt: Date.now(),
    manifestStore: memoryManifestStore(),
  };
}

describe('mutating-route input ceilings', () => {
  let deps: RoutesDeps;
  let app: ReturnType<typeof expressLikeApp>;

  beforeEach(() => {
    deps = makeDeps();
    app = expressLikeApp();
    app.use('/api', createRoutes(deps));
  });

  it('POST /api/events/bulk rejects more declarations than the ceiling, creating none', async () => {
    const events = Array.from({ length: MAX_BULK_EVENTS + 1 }, (_, i) => ({
      name: `probe.e${i}`,
      transport: 'signal' as const,
    }));

    const res = await request(app)
      .post('/api/events/bulk')
      .send({ serviceName: 'flood', events });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_BULK_EVENTS));
    // The registry must be untouched — the guard runs before any declare.
    expect(deps.registry.size()).toBe(0);
  });

  it('POST /api/events/bulk still accepts a request at the ceiling', async () => {
    const events = Array.from({ length: MAX_BULK_EVENTS }, (_, i) => ({
      name: `probe.e${i}`,
      transport: 'signal' as const,
    }));

    const res = await request(app)
      .post('/api/events/bulk')
      .send({ serviceName: 'legit', events });

    expect(res.status).toBe(201);
    expect(res.body.count).toBe(MAX_BULK_EVENTS);
    expect(deps.registry.size()).toBe(MAX_BULK_EVENTS);
  });

  it('POST /api/events/bulk/deprecate rejects an over-long names[]', async () => {
    const names = Array.from({ length: MAX_BULK_DEPRECATE_NAMES + 1 }, (_, i) => `e${i}`);
    const res = await request(app).post('/api/events/bulk/deprecate').send({ names });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_BULK_DEPRECATE_NAMES));
  });

  it('POST /api/transports/durable/dlq/replay rejects an over-long ids[]', async () => {
    const ids = Array.from({ length: MAX_DLQ_REPLAY_IDS + 1 }, (_, i) => `id-${i}`);
    const res = await request(app).post('/api/transports/durable/dlq/replay').send({ ids });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_DLQ_REPLAY_IDS));
  });

  it('POST /api/freshness rejects an over-long events[]', async () => {
    const events = Array.from({ length: MAX_FRESHNESS_EVENTS + 1 }, (_, i) => ({
      name: `e${i}`,
      fingerprint: 'a'.repeat(64),
    }));
    const res = await request(app).post('/api/freshness').send({ events });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_FRESHNESS_EVENTS));
  });

  it('PUT /api/manifests/:consumerName rejects an over-long events[]', async () => {
    const events = Array.from({ length: MAX_MANIFEST_EVENTS + 1 }, (_, i) => ({
      name: `e${i}`,
      fingerprint: 'a'.repeat(64),
    }));
    const res = await request(app).put('/api/manifests/greedy').send({ events });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_MANIFEST_EVENTS));
  });

  it('PUT /api/manifests/:consumerName rejects an over-long consumer name', async () => {
    // The name becomes a never-expiring Redis hash field.
    const name = 'c'.repeat(MAX_CONSUMER_NAME_LENGTH + 1);
    const res = await request(app).put(`/api/manifests/${name}`).send({ events: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain(String(MAX_CONSUMER_NAME_LENGTH));
    expect(await deps.manifestStore!.list()).toHaveLength(0);
  });

  it('GET /api/audit/recent rejects an unbounded limit', async () => {
    const withLog: RoutesDeps = {
      ...deps,
      auditLog: { recent: async () => [] },
    };
    const app2 = expressLikeApp();
    app2.use('/api', createRoutes(withLog));

    const res = await request(app2).get('/api/audit/recent?limit=100000000');
    expect(res.status).toBe(400);
  });
});

describe('event-name validation on the declare paths', () => {
  let deps: RoutesDeps;
  let app: ReturnType<typeof expressLikeApp>;

  beforeEach(() => {
    deps = makeDeps();
    app = expressLikeApp();
    app.use('/api', createRoutes(deps));
  });

  // Regression for a confirmed integrity hole: `POST /api/events` with
  // name `__proto__` returned 201 and the event showed up in
  // GET /api/events — but GET /api/fingerprints and
  // GET /api/metrics/history both returned `{}`, because assigning
  // `obj['__proto__']` on a plain object hits the prototype setter
  // instead of creating an own property. The event was invisible to
  // exactly the endpoint CI drift checks diff against.
  it.each(['__proto__', 'constructor', 'prototype'])(
    'rejects %s as an event name',
    async (name) => {
      const res = await request(app)
        .post('/api/events')
        .send({ name, transport: 'signal', producer: 'svc', schema: {} });
      expect(res.status).toBe(400);
      expect(deps.registry.get(name)).toBeUndefined();
    },
  );

  it('rejects an event name containing control characters', async () => {
    const res = await request(app)
      .post('/api/events')
      .send({ name: 'evil\ninjected: line', transport: 'signal', producer: 'svc', schema: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('control characters');
  });

  it('rejects an over-long event name', async () => {
    const res = await request(app).post('/api/events').send({
      name: 'a'.repeat(MAX_EVENT_NAME_LENGTH + 1),
      transport: 'signal',
      producer: 'svc',
      schema: {},
    });
    expect(res.status).toBe(400);
  });

  it('still accepts the naming shapes the platform actually uses', () => {
    for (const name of [
      'pipeline.run.started',
      'pipeline:run:started',
      'ws.pipeline.event',
      'call:caption:line',
      'error',
      'transcription:summary.ready',
    ]) {
      expect(validateEventName(name)).toBeNull();
    }
  });

  it('skips a bad name in a bulk declare but keeps the good ones', async () => {
    const res = await request(app).post('/api/events/bulk').send({
      serviceName: 'svc',
      events: [
        { name: 'good.one', transport: 'signal' },
        { name: '__proto__', transport: 'signal' },
        { name: 'good.two', transport: 'signal' },
      ],
    });

    expect(res.status).toBe(201);
    expect(res.body.declared).toEqual(['good.one', 'good.two']);
    expect(res.body.rejected).toHaveLength(1);
    expect(deps.registry.get('__proto__')).toBeUndefined();
  });
});

describe('responses keyed by event name survive a hostile key', () => {
  // Defence in depth behind the declare-time guard: a name can still
  // reach the registry through Redis hydration or a peer replica's
  // coordinator broadcast, and the read paths must report it honestly
  // rather than dropping it.
  it('GET /api/fingerprints reports an event named __proto__', async () => {
    const deps = makeDeps();
    // Bypass the HTTP guard the way Redis hydration / a peer broadcast would.
    deps.registry.declare({
      name: '__proto__',
      schema: { type: 'object' },
      transport: 'signal',
      producer: 'svc',
    });

    const app = expressLikeApp();
    app.use('/api', createRoutes(deps));

    const res = await request(app).get('/api/fingerprints');
    expect(res.status).toBe(200);
    expect(Object.keys(res.body)).toContain('__proto__');
  });

  it('MetricsCollector.getHistory reports an event named __proto__', () => {
    const metrics = new MetricsCollector(60);
    metrics.recordPublish('__proto__');
    metrics.tickRateHistory();

    const all = metrics.getHistory();
    expect(Object.keys(all)).toContain('__proto__');
    expect(JSON.parse(JSON.stringify(all))).toHaveProperty(['__proto__']);
  });
});
