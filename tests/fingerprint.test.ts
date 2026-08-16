// tests/fingerprint.test.ts
//
// Phase E6 — schema fingerprinting. Covers the helpers, the
// RegistryEntry integration, and the HTTP surface (POST 201 includes
// the field; GET endpoints expose it; the 409 enrichment is tested
// in strict-mode.test.ts).

import { describe, it, expect } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import request from 'supertest';

import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import {
  stableStringify,
  computeSchemaFingerprint,
} from '../src/registry/fingerprint.js';

describe('stableStringify', () => {
  it('emits the same bytes regardless of key insertion order', () => {
    const a = { type: 'object', required: ['x', 'y'], properties: { x: { type: 'string' } } };
    const b = { properties: { x: { type: 'string' } }, required: ['x', 'y'], type: 'object' };
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('preserves array order (positional, not sorted)', () => {
    expect(stableStringify({ required: ['b', 'a'] })).toBe('{"required":["b","a"]}');
    expect(stableStringify({ required: ['a', 'b'] })).toBe('{"required":["a","b"]}');
  });

  it('recursively sorts nested object keys', () => {
    const a = { outer: { z: 1, a: 2 } };
    const b = { outer: { a: 2, z: 1 } };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe('{"outer":{"a":2,"z":1}}');
  });

  it('throws on circular reference rather than silently truncating', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => stableStringify(cyclic)).toThrow(/circular reference/);
  });

  it('handles empty objects and primitives at the root', () => {
    expect(stableStringify({})).toBe('{}');
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(42)).toBe('42');
  });
});

describe('computeSchemaFingerprint', () => {
  it('returns a lowercase 64-char hex string', () => {
    const fp = computeSchemaFingerprint({ type: 'object' });
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces identical fingerprints for shape-identical schemas with different key order', () => {
    const a = { type: 'object', required: ['x'], properties: { x: { type: 'string' } } };
    const b = { properties: { x: { type: 'string' } }, required: ['x'], type: 'object' };
    expect(computeSchemaFingerprint(a)).toBe(computeSchemaFingerprint(b));
  });

  it('produces different fingerprints for materially different schemas', () => {
    const a = { type: 'object', required: ['x'] };
    const b = { type: 'object', required: ['y'] };
    expect(computeSchemaFingerprint(a)).not.toBe(computeSchemaFingerprint(b));
  });

  it('empty schema gets a stable fingerprint', () => {
    const fp = computeSchemaFingerprint({});
    // sha256('{}') is a known constant
    expect(fp).toBe('44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
  });
});

describe('Registry integration', () => {
  it('declare() assigns a schemaFingerprint on the new entry', () => {
    const reg = new Registry();
    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { orderId: { type: 'string' } } },
      transport: 'durable',
      producer: 'orders',
    });
    const entry = reg.get('order.created');
    expect(entry?.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('re-declare with the same shape (different key order) keeps the fingerprint', () => {
    const reg = new Registry();
    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      transport: 'durable',
      producer: 'orders',
    });
    const fp1 = reg.get('order.created')!.schemaFingerprint;

    reg.declare({
      name: 'order.created',
      schema: { required: ['x'], properties: { x: { type: 'string' } }, type: 'object' },
      transport: 'durable',
      producer: 'orders',
    });
    expect(reg.get('order.created')!.schemaFingerprint).toBe(fp1);
  });

  it('pushes the prior fingerprint into schemaHistory on schema change (Phase E6.5)', () => {
    const reg = new Registry();
    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
      transport: 'durable',
      producer: 'orders',
    });
    const fp1 = reg.get('order.created')!.schemaFingerprint;

    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } } },
      transport: 'durable',
      producer: 'orders',
      compatibilityMode: 'none',
    });
    const after = reg.get('order.created')!;
    expect(after.schemaHistory).toHaveLength(1);
    expect(after.schemaHistory[0]!.fingerprint).toBe(fp1);
    expect(after.schemaHistory[0]!.version).toBe(1);
  });

  it('re-declare with a different shape bumps the fingerprint and version together', () => {
    const reg = new Registry();
    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { x: { type: 'string' } } },
      transport: 'durable',
      producer: 'orders',
    });
    const before = reg.get('order.created')!;
    const fpBefore = before.schemaFingerprint;
    const verBefore = before.version;

    reg.declare({
      name: 'order.created',
      schema: { type: 'object', properties: { x: { type: 'string' }, y: { type: 'number' } } },
      transport: 'durable',
      producer: 'orders',
      compatibilityMode: 'none',
    });
    const after = reg.get('order.created')!;
    expect(after.schemaFingerprint).not.toBe(fpBefore);
    expect(after.version).toBe(verBefore + 1);
  });

  it('declare result carries the fingerprint for callers (POST 201 path)', () => {
    const reg = new Registry();
    const result = reg.declare({
      name: 'order.created',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'orders',
    });
    expect(result.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('HTTP surface — fingerprint on GET + POST responses', () => {
  function makeApp() {
    const registry = new Registry();
    const metrics = new MetricsCollector(60);
    const app = expressLikeApp();
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

  it('POST /api/events returns schemaFingerprint on the 201 response', async () => {
    const { app } = makeApp();
    const res = await request(app).post('/api/events').send({
      name: 'order.created',
      transport: 'durable',
      producer: 'orders',
      schema: { type: 'object', properties: { orderId: { type: 'string' } } },
    });
    expect(res.status).toBe(201);
    expect(res.body.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Also must equal what the registry stored.
    const fetched = await request(app).get('/api/events/order.created');
    expect(fetched.body.schemaFingerprint).toBe(res.body.schemaFingerprint);
  });

  it('GET /api/events returns schemaFingerprint on each entry', async () => {
    const { app, registry } = makeApp();
    registry.declare({
      name: 'order.created',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'orders',
    });
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
    expect(res.body.events[0].schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GET /api/events/:name returns schemaFingerprint', async () => {
    const { app, registry } = makeApp();
    registry.declare({
      name: 'order.created',
      schema: { type: 'object' },
      transport: 'durable',
      producer: 'orders',
    });
    const res = await request(app).get('/api/events/order.created');
    expect(res.status).toBe(200);
    expect(res.body.schemaFingerprint).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('Registry.migrateHistoryFingerprints() (Phase E6.5 backfill)', () => {
  it('returns 0 when no events are declared', () => {
    const registry = new Registry();
    expect(registry.migrateHistoryFingerprints()).toBe(0);
  });

  it('returns 0 when all history entries already have fingerprints', () => {
    const registry = new Registry();
    registry.declare({ name: 'ev.a', schema: { type: 'object' }, transport: 'signal', producer: 'svc' });
    // Re-declare with different schema to create a history entry with fingerprint
    registry.declare({ name: 'ev.a', schema: { type: 'object', properties: { x: { type: 'string' } } }, transport: 'signal', producer: 'svc' });
    // History entry was stamped with fingerprint during declare
    expect(registry.get('ev.a')!.schemaHistory.length).toBe(1);
    expect(registry.get('ev.a')!.schemaHistory[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    // Migration should be a no-op
    expect(registry.migrateHistoryFingerprints()).toBe(0);
  });

  it('backfills fingerprint on a history entry that is missing it', () => {
    const registry = new Registry();
    registry.declare({ name: 'ev.b', schema: { type: 'object' }, transport: 'signal', producer: 'svc' });
    registry.declare({ name: 'ev.b', schema: { type: 'object', properties: { y: { type: 'number' } } }, transport: 'signal', producer: 'svc' });

    // Simulate a pre-wave19-h entry by removing the fingerprint
    const entry = registry.get('ev.b')!;
    delete entry.schemaHistory[0]!.fingerprint;
    expect(entry.schemaHistory[0]!.fingerprint).toBeUndefined();

    const backfilled = registry.migrateHistoryFingerprints();
    expect(backfilled).toBe(1);
    expect(entry.schemaHistory[0]!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is idempotent — second call returns 0 after backfill', () => {
    const registry = new Registry();
    registry.declare({ name: 'ev.c', schema: { type: 'object' }, transport: 'signal', producer: 'svc' });
    registry.declare({ name: 'ev.c', schema: { type: 'string' }, transport: 'signal', producer: 'svc' });

    const entry = registry.get('ev.c')!;
    delete entry.schemaHistory[0]!.fingerprint;

    expect(registry.migrateHistoryFingerprints()).toBe(1); // first call backfills
    expect(registry.migrateHistoryFingerprints()).toBe(0); // second call is no-op
  });

  it('counts backfilled entries across multiple events', () => {
    const registry = new Registry();
    // Two events, each with one history entry lacking fingerprint
    for (const name of ['ev.d', 'ev.e']) {
      registry.declare({ name, schema: { type: 'object' }, transport: 'signal', producer: 'svc' });
      registry.declare({ name, schema: { type: 'string' }, transport: 'signal', producer: 'svc' });
      delete registry.get(name)!.schemaHistory[0]!.fingerprint;
    }
    expect(registry.migrateHistoryFingerprints()).toBe(2);
  });
});
