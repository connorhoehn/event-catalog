// tests/dlq-routes.test.ts
//
// Route-level tests for the three DLQ HTTP endpoints that had no coverage:
//   GET    /api/transports/durable/dlq
//   DELETE /api/transports/durable/dlq/:id
//   POST   /api/transports/durable/dlq/:id/replay
//
// The batch-replay route (POST /api/transports/durable/dlq/replay) already
// has thorough coverage in routes.test.ts — not duplicated here.

import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { Registry } from '../src/registry/index.js';
import { MetricsCollector } from '../src/server/metrics.js';
import { createRoutes, type RoutesDeps } from '../src/server/routes.js';

type DLQEntry = {
    id: string;
    pk: string;
    sk: string;
    eventName: string;
    payload: Record<string, unknown>;
    error: string;
    attempts: number;
    deadAt: string;
    ttl: number;
};

function makeEntry(overrides: Partial<DLQEntry> = {}): DLQEntry {
    return {
        id: 'entry-1',
        pk: 'DLQ#orders.failed',
        sk: '2026-05-15T00:00:00.000Z#entry-1',
        eventName: 'orders.failed',
        payload: { orderId: 'o1' },
        error: 'timeout',
        attempts: 3,
        deadAt: '2026-05-15T00:00:00.000Z',
        ttl: 1_700_000_000 + 30 * 86400,
        ...overrides,
    };
}

function createApp(overrides: Partial<RoutesDeps> = {}) {
    const defaultDlqStore: RoutesDeps['dlqStore'] = {
        list: vi.fn(async () => []),
        remove: vi.fn(async () => true),
        findById: vi.fn(async () => null),
        put: vi.fn(async () => makeEntry()),
        clear: vi.fn(async () => 0),
    };

    const defaultDurable: RoutesDeps['durable'] = {
        isConnected: () => true,
        healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
        getAllMetrics: () => new Map(),
        getDLQ: () => [],
        publish: vi.fn(async () => {}),
    } as unknown as RoutesDeps['durable'];

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
        durable: defaultDurable,
        dlqStore: defaultDlqStore,
        startedAt: Date.now(),
        ...overrides,
    };

    const app = express();
    app.use(express.json());
    app.use('/api', createRoutes(deps));
    return { app, deps };
}

// ─── GET /api/transports/durable/dlq ─────────────────────────────────────────

describe('GET /api/transports/durable/dlq', () => {
    it('returns 200 with messages array from dlqStore.list()', async () => {
        const entry = makeEntry();
        const dlqStore = {
            list: vi.fn(async () => [entry]),
            remove: vi.fn(),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(1);
        expect(res.body.total).toBe(1);
        expect(res.body.messages[0].eventName).toBe('orders.failed');
    });

    it('passes eventName query param to dlqStore.list()', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        await request(app).get('/api/transports/durable/dlq?eventName=orders.failed');
        expect(listFn).toHaveBeenCalledWith({ eventName: 'orders.failed', limit: undefined });
    });

    it('passes limit query param to dlqStore.list()', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        await request(app).get('/api/transports/durable/dlq?limit=10');
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: 10 });
    });

    it('falls back to in-memory durable.getDLQ() when dlqStore.list() throws', async () => {
        const inMemoryEntry = { id: 'im-1', eventName: 'orders.failed', payload: {}, error: 'boom', attempts: 1 };
        const dlqStore = {
            list: vi.fn().mockRejectedValue(new Error('DynamoDB unavailable')),
            remove: vi.fn(),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [inMemoryEntry],
            publish: vi.fn(),
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.source).toBe('in-memory');
        expect(res.body.messages).toHaveLength(1);
        expect(res.body.error).toBe('DynamoDB unavailable');
    });

    it('returns empty messages array when there are no entries', async () => {
        const { app } = createApp();
        const res = await request(app).get('/api/transports/durable/dlq');
        expect(res.status).toBe(200);
        expect(res.body.messages).toHaveLength(0);
        expect(res.body.total).toBe(0);
    });

    // ─── Input validation: reject malformed query strings rather than
    //     silently coercing to phantom-empty results (hub #898).
    it('rejects duplicate ?eventName=A&eventName=B with 400 (array form silently mis-targets the Query)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?eventName=A&eventName=B');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/eventName/);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects non-integer ?limit=abc with 400 (NaN limit silently asks DDB for NaN items)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=abc');
        expect(res.status).toBe(400);
        expect(res.body.error).toMatch(/limit/);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects non-positive ?limit=-5 with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=-5');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects ?limit=0 with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=0');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('rejects ?limit above MAX_DLQ_LIMIT (1001) with 400', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=1001');
        expect(res.status).toBe(400);
        expect(listFn).not.toHaveBeenCalled();
    });

    it('accepts ?limit at the MAX_DLQ_LIMIT boundary (1000)', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?limit=1000');
        expect(res.status).toBe(200);
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: 1000 });
    });

    it('treats whitespace-only ?eventName=%20 as no filter rather than partition "%20"', async () => {
        const listFn = vi.fn(async () => []);
        const dlqStore = { list: listFn, remove: vi.fn(), findById: vi.fn(), put: vi.fn(), clear: vi.fn() } as unknown as RoutesDeps['dlqStore'];
        const { app } = createApp({ dlqStore });

        const res = await request(app).get('/api/transports/durable/dlq?eventName=%20%20');
        expect(res.status).toBe(200);
        expect(listFn).toHaveBeenCalledWith({ eventName: undefined, limit: undefined });
    });
});

// ─── DELETE /api/transports/durable/dlq/:id ──────────────────────────────────

describe('DELETE /api/transports/durable/dlq/:id', () => {
    it('returns 200 with the removed id when entry exists', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(async () => true),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).delete('/api/transports/durable/dlq/entry-1');
        expect(res.status).toBe(200);
        expect(res.body.removed).toBe('entry-1');
    });

    it('returns 404 when entry does not exist', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(async () => false),
            findById: vi.fn(),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).delete('/api/transports/durable/dlq/ghost-id');
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('ghost-id');
    });
});

// ─── POST /api/transports/durable/dlq/:id/replay ─────────────────────────────

describe('POST /api/transports/durable/dlq/:id/replay', () => {
    it('returns 404 when the entry is not found', async () => {
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => null),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const { app } = createApp({ dlqStore });

        const res = await request(app).post('/api/transports/durable/dlq/no-such-id/replay');
        expect(res.status).toBe(404);
        expect(res.body.error).toContain('no-such-id');
    });

    it('re-publishes the entry and removes it, returning 200', async () => {
        const entry = makeEntry({ id: 'replay-me', eventName: 'orders.failed' });
        const removeFn = vi.fn(async () => true);
        const publishFn = vi.fn(async () => {});

        const dlqStore = {
            list: vi.fn(),
            remove: removeFn,
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [],
            publish: publishFn,
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app).post('/api/transports/durable/dlq/replay-me/replay');
        expect(res.status).toBe(200);
        expect(res.body.replayed).toBe('replay-me');
        expect(res.body.eventName).toBe('orders.failed');
        // Verify the publish call used the entry id as idempotency key
        expect(publishFn).toHaveBeenCalledTimes(1);
        const [queueName, envelope] = publishFn.mock.calls[0]!;
        expect(queueName).toBe('orders-failed');
        expect(envelope.metadata.id).toBe('replay-me');
        // Verify removal happened after successful publish
        expect(removeFn).toHaveBeenCalledWith('replay-me');
    });

    it('returns 500 when durable.publish() throws', async () => {
        const entry = makeEntry({ id: 'fail-replay' });
        const dlqStore = {
            list: vi.fn(),
            remove: vi.fn(),
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [],
            publish: vi.fn(async () => { throw new Error('queue full'); }),
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        const res = await request(app).post('/api/transports/durable/dlq/fail-replay/replay');
        expect(res.status).toBe(500);
        expect(res.body.error).toContain('queue full');
    });

    it('does not call dlqStore.remove() when publish fails', async () => {
        const entry = makeEntry({ id: 'keep-me' });
        const removeFn = vi.fn();
        const dlqStore = {
            list: vi.fn(),
            remove: removeFn,
            findById: vi.fn(async () => entry),
            put: vi.fn(),
            clear: vi.fn(),
        } as unknown as RoutesDeps['dlqStore'];

        const durable = {
            isConnected: () => true,
            healthCheck: async () => ({ status: 'connected' as const, latencyMs: 1 }),
            getAllMetrics: () => new Map(),
            getDLQ: () => [],
            publish: vi.fn(async () => { throw new Error('network error'); }),
        } as unknown as RoutesDeps['durable'];

        const { app } = createApp({ dlqStore, durable });

        await request(app).post('/api/transports/durable/dlq/keep-me/replay');
        expect(removeFn).not.toHaveBeenCalled();
    });
});
