// tests/manifest-store.test.ts
//
// wave23-b — consumer manifest pinning. Covers the pure
// buildDriftReport helper, the RedisManifestStore CRUD path with a
// mock Redis client, and the HTTP routes via supertest + a tiny
// in-memory store fake.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import {
  buildDriftReport,
  RedisManifestStore,
  type ManifestEntry,
  type ManifestStore,
} from '../src/server/manifest-store.js';

describe('buildDriftReport (wave23-b)', () => {
  const manifest: ManifestEntry = {
    consumerName: 'audit-worker',
    updatedAt: '2026-05-15T10:00:00.000Z',
    events: [
      { name: 'pipeline.run.started', fingerprint: 'a'.repeat(64) },
      { name: 'sfu.stream.started', fingerprint: 'b'.repeat(64) },
      { name: 'unknown.event', fingerprint: 'c'.repeat(64) },
    ],
  };

  it('marks fingerprints fresh / stale / unknown correctly', () => {
    const current = new Map([
      ['pipeline.run.started', 'a'.repeat(64)],   // fresh
      ['sfu.stream.started', 'X'.repeat(64)],     // stale
      // unknown.event missing → status 'unknown'
    ]);
    const report = buildDriftReport(manifest, current);
    expect(report.consumerName).toBe('audit-worker');
    expect(report.events).toHaveLength(3);
    expect(report.events[0]!.status).toBe('fresh');
    expect(report.events[1]!.status).toBe('stale');
    expect(report.events[2]!.status).toBe('unknown');
    expect(report.summary).toEqual({ fresh: 1, stale: 1, unknown: 1 });
  });

  it('summary sums to manifest.events.length', () => {
    const current = new Map<string, string>();
    const report = buildDriftReport(manifest, current);
    const total = report.summary.fresh + report.summary.stale + report.summary.unknown;
    expect(total).toBe(manifest.events.length);
  });
});

describe('RedisManifestStore (wave23-b)', () => {
  function makeMockRedis() {
    const store = new Map<string, string>();
    return {
      store,
      hSet: vi.fn(async (_key: string, field: string, value: string) => { store.set(field, value); return 1; }),
      hGet: vi.fn(async (_key: string, field: string) => store.get(field)),
      hGetAll: vi.fn(async () => Object.fromEntries(store)),
      hDel: vi.fn(async (_key: string, field: string) => (store.delete(field) ? 1 : 0)),
    };
  }

  it('put → get round-trips a manifest', async () => {
    const r = makeMockRedis();
    const s = new RedisManifestStore(r as never);
    const stored = await s.put({
      consumerName: 'audit-worker',
      events: [{ name: 'a.x', fingerprint: 'f'.repeat(64) }],
    });
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const got = await s.get('audit-worker');
    expect(got?.events[0]?.name).toBe('a.x');
  });

  it('get returns null for missing consumers', async () => {
    const s = new RedisManifestStore(makeMockRedis() as never);
    expect(await s.get('nobody')).toBeNull();
  });

  it('list returns all stored manifests', async () => {
    const r = makeMockRedis();
    const s = new RedisManifestStore(r as never);
    await s.put({ consumerName: 'c1', events: [{ name: 'a.x', fingerprint: 'a'.repeat(64) }] });
    await s.put({ consumerName: 'c2', events: [{ name: 'b.y', fingerprint: 'b'.repeat(64) }] });
    const all = await s.list();
    expect(all.map((m) => m.consumerName).sort()).toEqual(['c1', 'c2']);
  });

  it('remove returns true on hit, false on miss', async () => {
    const r = makeMockRedis();
    const s = new RedisManifestStore(r as never);
    await s.put({ consumerName: 'c1', events: [{ name: 'a', fingerprint: 'f'.repeat(64) }] });
    expect(await s.remove('c1')).toBe(true);
    expect(await s.remove('c1')).toBe(false);
  });

  it('list silently drops unparseable entries', async () => {
    const r = makeMockRedis();
    r.store.set('legit', JSON.stringify({ consumerName: 'legit', events: [], updatedAt: 'now' }));
    r.store.set('garbage', 'not json {{');
    const s = new RedisManifestStore(r as never);
    const all = await s.list();
    expect(all.map((m) => m.consumerName)).toEqual(['legit']);
  });
});

describe('manifest routes', () => {
  function makeApp() {
    const registry = new Registry();
    const metrics = new MetricsCollector(60);
    const inMemory: ManifestStore = (() => {
      const map = new Map<string, ManifestEntry>();
      return {
        async put(e) {
          const stored: ManifestEntry = { consumerName: e.consumerName, events: e.events.slice(), updatedAt: '2026-05-15T00:00:00.000Z' };
          map.set(e.consumerName, stored);
          return stored;
        },
        async get(name) { return map.get(name) ?? null; },
        async list() { return [...map.values()]; },
        async remove(name) { return map.delete(name); },
        async driftReport(current) {
          return [...map.values()].map((m) => buildDriftReport(m, current));
        },
      };
    })();
    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes({
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
      manifestStore: inMemory,
    }));
    return { app, registry };
  }

  it('PUT /api/manifests/:consumer + GET round-trips', async () => {
    const { app } = makeApp();
    const put = await request(app).put('/api/manifests/audit-worker').send({
      events: [{ name: 'a.x', fingerprint: 'a'.repeat(64) }],
    });
    expect(put.status).toBe(201);
    expect(put.body.consumerName).toBe('audit-worker');

    const get = await request(app).get('/api/manifests/audit-worker');
    expect(get.status).toBe(200);
    expect(get.body.events[0].name).toBe('a.x');
  });

  it('PUT rejects malformed body with 400', async () => {
    const { app } = makeApp();
    const noEvents = await request(app).put('/api/manifests/c').send({});
    expect(noEvents.status).toBe(400);

    const wrongShape = await request(app).put('/api/manifests/c').send({ events: [{ name: 'x' }] });
    expect(wrongShape.status).toBe(400);
  });

  it('GET /api/manifests lists every pinned manifest', async () => {
    const { app } = makeApp();
    await request(app).put('/api/manifests/c1').send({ events: [{ name: 'a', fingerprint: 'a'.repeat(64) }] });
    await request(app).put('/api/manifests/c2').send({ events: [{ name: 'b', fingerprint: 'b'.repeat(64) }] });
    const res = await request(app).get('/api/manifests');
    expect(res.body.count).toBe(2);
  });

  it('DELETE /api/manifests/:consumer removes the manifest', async () => {
    const { app } = makeApp();
    await request(app).put('/api/manifests/c1').send({ events: [{ name: 'a', fingerprint: 'a'.repeat(64) }] });
    const del = await request(app).delete('/api/manifests/c1');
    expect(del.status).toBe(200);
    const after = await request(app).get('/api/manifests/c1');
    expect(after.status).toBe(404);
  });

  it('GET /api/manifests/check/all reports drift across consumers', async () => {
    const { app, registry } = makeApp();
    registry.declare({ name: 'a.x', schema: { type: 'object' }, transport: 'signal', producer: 's' });
    const localFp = registry.get('a.x')!.schemaFingerprint;
    // Pin one consumer at the current fingerprint, another at a stale value.
    await request(app).put('/api/manifests/fresh-consumer').send({
      events: [{ name: 'a.x', fingerprint: localFp }],
    });
    await request(app).put('/api/manifests/stale-consumer').send({
      events: [{ name: 'a.x', fingerprint: 'X'.repeat(64) }],
    });

    const res = await request(app).get('/api/manifests/check/all');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(res.body.reports.map((r: { consumerName: string }) => [r.consumerName, r]));
    expect(byName['fresh-consumer'].summary.fresh).toBe(1);
    expect(byName['stale-consumer'].summary.stale).toBe(1);
  });
});
