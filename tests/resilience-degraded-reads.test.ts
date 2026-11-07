// tests/resilience-degraded-reads.test.ts
//
// Every read path with a fallback, driven with its primary DEGRADED
// rather than absent — a DynamoDB that throttles, a Redis whose socket
// has gone away mid-session. The failure mode these guard against is
// not a crash: it is a 200 that answers a narrower or different
// question than the one the caller asked, at exactly the moment an
// operator is leaning on the answer.
//
// Assertions are on the HTTP response an operator actually receives.
// Where a route currently answers dishonestly, the test says so in a
// BUG comment and pins the present behaviour so the change is visible
// in a diff when it is fixed.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { expressLikeApp } from './helpers/test-app.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';
import { DLQStore } from '../src/server/dlq-store.js';
import { startAuditLog } from '../src/server/audit-log.js';
import { Registry } from '../src/registry/index.js';
import {
  connectionIsClosed,
  makeRoutesDeps,
  mirrorEntry,
  provisionedThroughputExceeded,
  storeEntry,
} from './helpers/degraded-deps.js';

function appFor(deps: RoutesDeps) {
  const app = expressLikeApp();
  app.use('/api', createRoutes(deps));
  return app;
}

const DLQ_PATH = '/api/transports/durable/dlq';

let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// DLQ list — DynamoDB throttling (the table is UP; the call just failed)
// ---------------------------------------------------------------------------

describe('GET /api/transports/durable/dlq — DynamoDB throttling, not an outage', () => {
  function throttledApp(mirror: unknown[]) {
    return appFor(makeRoutesDeps({
      dlqStore: { list: vi.fn(async () => { throw provisionedThroughputExceeded(); }) },
      durable: { getDLQ: () => mirror as never },
    }));
  }

  it('says which source answered instead of passing the mirror off as the store', async () => {
    const res = await request(throttledApp([mirrorEntry(1)])).get(DLQ_PATH);

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('in-memory');
    // The whole point: an operator reading this response can tell the
    // number in front of them is this process's partial view.
    expect(String(res.body.error)).toMatch(/in-memory mirror/i);
    expect(res.body.messages).toHaveLength(1);
  });

  it('a throttle with an empty mirror is not reported as a clean DLQ', async () => {
    const res = await request(throttledApp([])).get(DLQ_PATH);

    // `total: 0` is unavoidable here — the mirror really is empty. What
    // must NOT happen is `source: 'store'`, which would read as "the DLQ
    // is clear" during the incident that filled it.
    expect(res.body.total).toBe(0);
    expect(res.body.source).toBe('in-memory');
    expect(res.body.error).toBeDefined();
  });

  it('never leaks the AWS throttle text — table name, request id, service — to the caller', async () => {
    const res = await request(throttledApp([mirrorEntry(1)])).get(DLQ_PATH);

    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toContain('ProvisionedThroughputExceeded');
    expect(serialized).not.toContain('UpdateTable');
    expect(serialized).not.toContain('DynamoDb');
    // …but the operator can still find it in the server log.
    const logged = warnSpy.mock.calls.map(c => c.join(' ')).join('\n');
    expect(logged).toContain('provisioned throughput');
  });

  it('still honours ?eventName= while degraded, rather than widening to everything', async () => {
    const app = throttledApp([
      mirrorEntry(1, 'orders:failed'),
      mirrorEntry(2, 'payments:failed'),
      mirrorEntry(3, 'orders:failed'),
    ]);

    const res = await request(app).get(`${DLQ_PATH}?eventName=payments:failed`);

    expect(res.body.source).toBe('in-memory');
    expect(res.body.messages.map((m: { eventName: string }) => m.eventName))
      .toEqual(['payments:failed']);
  });

  it('serves the same wire shape from the mirror as from the store', async () => {
    const healthy = await request(appFor(makeRoutesDeps({
      dlqStore: { list: vi.fn(async () => [storeEntry(1)]) },
    }))).get(DLQ_PATH);

    const degraded = await request(throttledApp([mirrorEntry(1)])).get(DLQ_PATH);

    const shape = (m: Record<string, unknown>) => Object.keys(m).sort();
    // `expiresAt` is the one legitimate difference: the mirror has no
    // expiry concept, so the field is absent rather than invented.
    expect(shape(healthy.body.messages[0]).filter(k => k !== 'expiresAt'))
      .toEqual(shape(degraded.body.messages[0]));
    expect(degraded.body.messages[0].expiresAt).toBeUndefined();
    // Storage keys must not reappear on either path.
    expect(degraded.body.messages[0].pk).toBeUndefined();
    expect(healthy.body.messages[0].pk).toBeUndefined();
  });

  it('?limit= means the newest entries from the mirror as it does from the store', async () => {
    // Establish what the primary answers. DLQStore.list queries with
    // ScanIndexForward: false, i.e. newest-first, so `?limit=2` on a
    // healthy store means "the two most recent dead letters".
    const ddb = {
      send: vi.fn(async () => ({
        // DDB hands back descending sk order for ScanIndexForward: false.
        Items: [storeEntry(5), storeEntry(4), storeEntry(3), storeEntry(2), storeEntry(1)],
      })),
    };
    const store = new DLQStore(ddb as never, 'dlq-table', async () => {});
    const healthy = await request(appFor(makeRoutesDeps({
      dlqStore: { list: (opts) => store.list(opts) },
    }))).get(`${DLQ_PATH}?eventName=orders:failed&limit=2`);

    expect(healthy.body.messages.map((m: { payload: { seq: number } }) => m.payload.seq))
      .toEqual([5, 4]);

    // Regression: the mirror is append-ordered and the fallback sliced from
    // the head, so mid-incident the same query answered with the two entries
    // furthest in the PAST — the least useful two it holds, and silently a
    // different question from the one the store answered.
    const degraded = await request(throttledApp([
      mirrorEntry(1), mirrorEntry(2), mirrorEntry(3), mirrorEntry(4), mirrorEntry(5),
    ])).get(`${DLQ_PATH}?eventName=orders:failed&limit=2`);

    expect(degraded.body.messages.map((m: { payload: { seq: number } }) => m.payload.seq))
      // Newest-first, matching the store: a degraded read answers the same
      // question a healthy one does.
      .toEqual([5, 4]);
  });

  it('replay stays unavailable while the store is throttled rather than silently no-op', async () => {
    const app = appFor(makeRoutesDeps({
      dlqStore: { findById: vi.fn(async () => { throw provisionedThroughputExceeded(); }) },
    }));

    const res = await request(app).post(`${DLQ_PATH}/entry-1/replay`).send({});

    // An id read off the degraded list is not replayable, and the route
    // says so with a 5xx instead of reporting a replay that never
    // happened.
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(JSON.stringify(res.body)).not.toContain('ProvisionedThroughputExceeded');
  });

  it('batch replay reports a throttled entry as failed and keeps going', async () => {
    let call = 0;
    // Replay re-validates against the registry, so the event must be declared.
    const registry = new Registry();
    registry.declare({ name: 'orders:failed', transport: 'durable', producer: 'order-service' });
    const app = appFor(makeRoutesDeps({
      registry,
      dlqStore: {
        findById: vi.fn(async (id: string) => {
          call++;
          if (call === 1) throw provisionedThroughputExceeded();
          return { ...storeEntry(2), id };
        }),
        remove: vi.fn(async () => true),
      },
    }));

    const res = await request(app)
      .post(`${DLQ_PATH}/replay`)
      .send({ ids: ['a', 'b'] });

    // Regression: findById used to sit OUTSIDE the per-id try/catch, so one
    // throttled read aborted the whole batch — including ids that would have
    // succeeded — and the caller got a bare 500 with nothing to retry from.
    // Now the throttled id is reported as failed and the batch continues.
    expect(res.status).toBe(200);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].id).toBe('a');
    expect(res.body.replayed.map((r: { id: string }) => r.id)).toEqual(['b']);
  });
});

// ---------------------------------------------------------------------------
// DLQ clear — throttled part-way through a multi-page delete
// ---------------------------------------------------------------------------

describe('DLQStore.clear — throttled mid-pagination', () => {
  it('loses the count of what it already deleted', async () => {
    let scans = 0;
    const client = {
      send: vi.fn(async (cmd: object) => {
        if (cmd.constructor.name === 'BatchWriteCommand') return { UnprocessedItems: {} };
        scans++;
        if (scans === 1) {
          return {
            Items: [storeEntry(1), storeEntry(2)],
            LastEvaluatedKey: { pk: 'DLQ#orders:failed', sk: 'x' },
          };
        }
        throw provisionedThroughputExceeded();
      }),
    };
    const store = new DLQStore(client as never, 'dlq-table', async () => {});

    await expect(store.clear()).rejects.toThrow(/provisioned throughput/i);

    // BUG (report): the first page's two deletes DID commit — the
    // BatchWrite went through — but `clear()` throws, so the route
    // returns 500 and the operator is told nothing was cleared. A retry
    // is safe (the deletes are idempotent) but the reported count is a
    // lie by omission. src/server/dlq-store.ts clear() accumulates
    // `deleted` in a local that is discarded when a later page throws.
    const batchWrites = client.send.mock.calls
      .filter(([cmd]) => (cmd as object).constructor.name === 'BatchWriteCommand');
    expect(batchWrites).toHaveLength(1);
  });

  it('retries throttled BatchWrite items rather than counting them deleted', async () => {
    let batch = 0;
    const client = {
      send: vi.fn(async (cmd: object) => {
        if (cmd.constructor.name !== 'BatchWriteCommand') {
          return batch === 0 ? { Items: [storeEntry(1), storeEntry(2)] } : { Items: [] };
        }
        batch++;
        // DDB reports throttled deletes in UnprocessedItems and still
        // returns 200 — a store that trusted the 200 would report two
        // deletions for one.
        if (batch === 1) {
          return {
            UnprocessedItems: {
              'dlq-table': [{ DeleteRequest: { Key: { pk: 'DLQ#orders:failed', sk: 'sk-2' } } }],
            },
          };
        }
        return { UnprocessedItems: {} };
      }),
    };
    const store = new DLQStore(client as never, 'dlq-table', async () => {});

    await expect(store.clear()).resolves.toBe(2);
    expect(batch).toBe(2);
  });

  it('gives up loudly rather than silently under-deleting when the throttle persists', async () => {
    const client = {
      send: vi.fn(async (cmd: object) => {
        if (cmd.constructor.name !== 'BatchWriteCommand') return { Items: [storeEntry(1)] };
        return {
          UnprocessedItems: {
            'dlq-table': [{ DeleteRequest: { Key: { pk: 'DLQ#orders:failed', sk: 'sk-1' } } }],
          },
        };
      }),
    };
    const store = new DLQStore(client as never, 'dlq-table', async () => {});

    await expect(store.clear()).rejects.toThrow(/still unprocessed after 5 retries/);
  });
});

// ---------------------------------------------------------------------------
// Audit log — Redis dropped mid-session
// ---------------------------------------------------------------------------

describe('GET /api/audit/recent — Redis dropped after boot', () => {
  it('reports an unavailable audit history rather than an empty one', async () => {
    const log = startAuditLog({
      redis: {
        lPush: async () => { throw connectionIsClosed(); },
        lTrim: async () => 0,
        lRange: async () => { throw connectionIsClosed(); },
      } as never,
    });
    const res = await request(appFor(makeRoutesDeps({ auditLog: log }))).get('/api/audit/recent');
    log.stop();

    // Regression: this returned 200 {events: []}, identical to "no audit
    // events have happened" — the exact failure the DLQ list route was fixed
    // for. A 503 naming the distinction is the whole point.
    expect(res.status).toBe(503);
    expect(res.body.events).toBeUndefined();
    expect(String(res.body.error)).toMatch(/not the same as an empty history/i);
  });

  it('a Redis write failure does not break the live audit emit', async () => {
    const log = startAuditLog({
      redis: {
        lPush: async () => { throw connectionIsClosed(); },
        lTrim: async () => 0,
        lRange: async () => [],
      } as never,
    });
    const { auditEmitter } = await import('../src/server/audit-emitter.js');
    const seen: unknown[] = [];
    const listener = (e: unknown): void => { seen.push(e); };
    auditEmitter.on('audit', listener);

    auditEmitter.publish({
      kind: 'event.declared',
      timestamp: new Date().toISOString(),
      eventName: 'orders:created',
      namespace: 'orders',
      version: 1,
    });
    // Let the async Redis write reject on its own microtask.
    await Promise.resolve();
    await Promise.resolve();

    auditEmitter.off('audit', listener);
    log.stop();
    expect(seen).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Signal history — Redis errors on the read
// ---------------------------------------------------------------------------

describe('GET /api/events/:name/history — Redis erroring on XRANGE', () => {
  it('BUG: an unreadable ring buffer is reported as an empty one', async () => {
    const registry = new Registry();
    registry.declare({
      name: 'ws:typing',
      schema: { type: 'object', properties: {}, additionalProperties: true },
      transport: 'signal',
      producer: 'gateway',
    });

    const res = await request(appFor(makeRoutesDeps({
      registry,
      // SignalTransport.getHistory() catches every Redis error and
      // returns [] — the route cannot tell the two apart either.
      signal: { getHistory: async () => [] },
    }))).get('/api/events/ws:typing/history');

    expect(res.status).toBe(200);
    // BUG (report): src/client/signal.ts getHistory() swallows the error;
    // "Redis is refusing reads" and "nothing was published" are the same
    // response.
    expect(res.body).toEqual({ messages: [], transport: 'signal' });
  });
});

// ---------------------------------------------------------------------------
// Registry health — a degraded manifest store must not fail the probe
// ---------------------------------------------------------------------------

describe('GET /api/health/registry — one degraded dependency', () => {
  it('reports manifestCount: null rather than 0 when Redis refuses the read', async () => {
    const res = await request(appFor(makeRoutesDeps({
      manifestStore: {
        list: async () => { throw connectionIsClosed(); },
      } as unknown as RoutesDeps['manifestStore'],
    }))).get('/api/health/registry');

    expect(res.status).toBe(200);
    // null, not 0: "we could not count" is a different fact from "there
    // are none pinned", and the admin UI renders them differently.
    expect(res.body.manifestCount).toBeNull();
    expect(res.body.registrySize).toBe(0);
  });
});
