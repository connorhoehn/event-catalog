// tests/dead-letter-callback.test.ts
//
// Phase 20-d — server-side DLQ callback assembly. Verifies the DLQ
// write happens first (always, even if extra handlers are registered),
// extra handlers receive enriched context (registry entry + namespace),
// and a thrown handler is contained.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { expressLikeApp } from './helpers/test-app.js';
import type { Middleware } from '../src/server/http-router.js';
import request from 'supertest';
import { buildDeadLetterCallback, type DeadLetterHandler } from '../src/server/index.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import type { RegistryEntry } from '../src/types/index.js';
import type { DeadLetteredMessage } from '../src/client/durable.js';

function fakeEntry(name: string, namespace: string): RegistryEntry {
  return {
    name,
    namespace,
    schema: { type: 'object' },
    transport: 'durable',
    producer: 'test',
    version: 1,
    schemaFingerprint: 'deadbeef'.repeat(8),
    compatibilityMode: 'backward',
    schemaHistory: [],
    subscribers: [],
    dlqRetention: 12345,
    metadata: { createdAt: '', lastPublishedAt: null, publishCount: 0, errorCount: 0 },
  };
}

const baseMessage: DeadLetteredMessage = {
  envelope: { eventName: 'orders.failed', payload: { id: 'o1' }, metadata: { id: 'm1', producer: 'orders', timestamp: 0 } },
  error: 'consumer threw',
  attempts: 3,
  deadLetteredAt: '2026-05-15T12:00:00.000Z',
};

describe('buildDeadLetterCallback', () => {
  let putSpy: ReturnType<typeof vi.fn>;
  let dlqStore: { put: typeof putSpy };
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    putSpy = vi.fn().mockResolvedValue({});
    dlqStore = { put: putSpy };
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('writes to DLQ store using the registry entry dlqRetention override', () => {
    const registry = { get: () => fakeEntry('orders.failed', 'orders') };
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [],
    });
    cb(baseMessage);
    expect(putSpy).toHaveBeenCalledOnce();
    const [putEntry, retention] = putSpy.mock.calls[0]!;
    expect(putEntry).toMatchObject({ eventName: 'orders.failed', attempts: 3 });
    expect(retention).toBe(12345);
  });

  it('falls back to no retention when the event is undeclared', () => {
    const registry = { get: () => undefined };
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [],
    });
    cb(baseMessage);
    const [, retention] = putSpy.mock.calls[0]!;
    expect(retention).toBeUndefined();
  });

  it('fans out to additional handlers with enriched context (entry + namespace)', async () => {
    const registry = { get: () => fakeEntry('orders.failed', 'orders') };
    const seen: Array<{ name: string; ns: string | undefined }> = [];
    const handler: DeadLetterHandler = (msg, ctx) => {
      seen.push({ name: msg.envelope.eventName, ns: ctx.namespace });
    };
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [handler, handler], // two handlers, both fire
    });
    cb(baseMessage);
    // Handlers run via Promise.resolve — wait a microtask.
    await new Promise((r) => setImmediate(r));
    expect(seen).toEqual([
      { name: 'orders.failed', ns: 'orders' },
      { name: 'orders.failed', ns: 'orders' },
    ]);
  });

  it('context.entry is undefined for undeclared events but the handlers still fire', async () => {
    const registry = { get: () => undefined };
    let saw: { entry: RegistryEntry | undefined; ns: string | undefined } | null = null;
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [(_msg, ctx) => { saw = { entry: ctx.entry, ns: ctx.namespace }; }],
    });
    cb(baseMessage);
    await new Promise((r) => setImmediate(r));
    expect(saw).toEqual({ entry: undefined, ns: undefined });
  });

  it('a thrown handler is caught + logged; DLQ write still happens', async () => {
    const registry = { get: () => fakeEntry('orders.failed', 'orders') };
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [
        () => { throw new Error('webhook unreachable'); },
      ],
    });
    cb(baseMessage);
    await new Promise((r) => setImmediate(r));
    expect(putSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('DLQ handler threw on "orders.failed"'),
      'webhook unreachable',
    );
  });

  it('DLQ store rejection is caught and logged (does not bubble)', () => {
    putSpy.mockRejectedValueOnce(new Error('DDB throttled'));
    const registry = { get: () => fakeEntry('orders.failed', 'orders') };
    const cb = buildDeadLetterCallback({
      registry,
      dlqStore: dlqStore as never,
      additionalHandlers: [],
    });
    expect(() => cb(baseMessage)).not.toThrow();
  });
});

describe('authMiddleware seam (wave20-d)', () => {
  function makeApp(authMiddleware?: Middleware) {
    const registry = new Registry();
    const metrics = new MetricsCollector(60);
    const app = expressLikeApp();
    const deps = {
      registry,
      metrics,
      metricsObserver: { observe: async () => {} } as unknown as RoutesDeps['metricsObserver'],
      signal: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map(), getHistory: async () => [] } as unknown as RoutesDeps['signal'],
      durable: { isConnected: () => true, healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }), getAllMetrics: () => new Map() } as unknown as RoutesDeps['durable'],
      dlqStore: { list: async () => [], remove: async () => true, findById: async () => null, put: async () => ({}) } as unknown as RoutesDeps['dlqStore'],
      startedAt: Date.now(),
    };
    if (authMiddleware) app.use('/api', authMiddleware);
    app.use('/api', createRoutes(deps));
    return app;
  }

  it('routes are reachable without auth (current default)', async () => {
    const app = makeApp();
    const res = await request(app).get('/api/events');
    expect(res.status).toBe(200);
  });

  it('auth middleware mounted before /api gates every admin endpoint', async () => {
    const requireKey: Middleware = (req, res, next) => {
      if (req.header('x-api-key') !== 'secret') {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      next();
    };
    const app = makeApp(requireKey);

    const blocked = await request(app).get('/api/events');
    expect(blocked.status).toBe(401);
    expect(blocked.body.error).toBe('unauthorized');

    const allowed = await request(app).get('/api/events').set('x-api-key', 'secret');
    expect(allowed.status).toBe(200);
  });
});
